import { Inject, Injectable, Logger } from '@nestjs/common';
import { CatalogCandidateValidatorService } from '@activities/services/catalog-candidate-validator.service';
import { CatalogCandidate } from '@activities/interfaces/catalog-candidate-validation.interface';
import {
  OsmCandidate,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import {
  IPlacesApiService,
  PlaceData,
} from '@integrations/google-places/interfaces/places-api.interface';
import {
  ActivityProposal,
  EntityHint,
} from '../interfaces/activity-discovery.interface';
import {
  ProposalResolutionRequest,
  ProposalResolutionResponse,
  ResolvedActivityProposal,
  ResolvedEntity,
  ResolvedEntityAdminContext,
} from '../interfaces/proposal-resolution.interface';

const GENERIC_AREA_PHRASES = new Set([
  'downtown',
  'city center',
  'city centre',
  'centre',
  'center',
  'old town',
]);

const ROUTE_LIKE_TYPES = new Set([
  'street',
  'road',
  'pedestrian street',
  'avenue',
  'boulevard',
  'path',
  'route',
  'trail',
  'walkway',
  'lane',
  'highway',
  'promenade',
  'boardwalk',
  'riverwalk',
  'waterfront',
]);

@Injectable()
export class ActivityProposalResolutionService {
  private readonly logger = new Logger(ActivityProposalResolutionService.name);

  constructor(
    @Inject('PlacesApiService')
    private readonly placesApi: IPlacesApiService,
    private readonly osmPlacesService: OsmPlacesService,
    private readonly catalogCandidateValidator: CatalogCandidateValidatorService,
  ) {}

  /**
   * Resolution does one thing only: turn untrusted entity hints into provider-
   * resolved real-world entities. It does not approve geographic coherence and
   * it does not persist a composite Activity.
   */
  async resolve(
    request: ProposalResolutionRequest,
  ): Promise<ProposalResolutionResponse> {
    const resolved: ResolvedActivityProposal[] = [];
    for (const proposal of request.proposals) {
      resolved.push(await this.resolveProposal(proposal, request));
    }

    const acceptedCount = resolved.filter(
      (entry) => entry.status === 'accepted' || entry.status === 'partial',
    ).length;
    const rejectedCount = resolved.filter(
      (entry) => entry.status === 'rejected',
    ).length;
    return {
      resolved,
      totalProposals: request.proposals.length,
      acceptedCount,
      rejectedCount,
    };
  }

  private async resolveProposal(
    proposal: ActivityProposal,
    request: ProposalResolutionRequest,
  ): Promise<ResolvedActivityProposal> {
    if (!request.destinationBoundary) {
      return this.reject(proposal, [], ['missing_destination_boundary']);
    }

    switch (proposal.kind) {
      case 'AREA':
        return this.resolveAreaProposal(proposal, request.destinationBoundary);
      case 'POI':
        return this.resolvePoiProposal(proposal, request);
      case 'ROUTE':
      case 'NEIGHBORHOOD_WALK':
      case 'EXPERIENCE':
        return this.resolveCompositeProposal(proposal, request);
      default:
        return this.reject(proposal, [], ['unknown_kind']);
    }
  }

  private async resolveAreaProposal(
    proposal: ActivityProposal,
    destination: OsmCandidate,
  ): Promise<ResolvedActivityProposal> {
    const areaHint = proposal.entityHints.find((hint) => hint.role === 'area');
    if (!areaHint) {
      return this.reject(proposal, [], ['missing_required_hint']);
    }
    const result = await this.resolveAreaHint(areaHint, destination);
    if (result.entity.status !== 'resolved') {
      return this.reject(proposal, [result.entity], [
        result.entity.rejectionReason ?? 'unresolved_area',
      ]);
    }
    return this.resolvedProposal(proposal, [result.entity]);
  }

  private async resolvePoiProposal(
    proposal: ActivityProposal,
    request: ProposalResolutionRequest,
  ): Promise<ResolvedActivityProposal> {
    const venueHint = proposal.entityHints.find(
      (hint) => hint.role === 'venue' || hint.role === 'waypoint',
    );
    if (!venueHint) {
      return this.reject(proposal, [], ['missing_required_hint']);
    }
    const entity = await this.resolveVenueHint(venueHint, request);
    if (entity.status !== 'resolved') {
      return this.reject(proposal, [entity], [
        entity.rejectionReason ?? 'unresolved_venue',
      ]);
    }
    return this.resolvedProposal(proposal, [entity]);
  }

  private async resolveCompositeProposal(
    proposal: ActivityProposal,
    request: ProposalResolutionRequest,
  ): Promise<ResolvedActivityProposal> {
    const destination = request.destinationBoundary as OsmCandidate;
    const entities: ResolvedEntity[] = [];
    const reasons: string[] = [];

    // An area is useful context, but absence/unresolvability is not a universal
    // rejection for ROUTE/EXPERIENCE and is not fatal for NEIGHBORHOOD_WALK:
    // the geographic validator may validate a walk from compact anchors.
    const areaHint = proposal.entityHints.find((hint) => hint.role === 'area');
    let resolvedAreaCandidate: OsmCandidate | undefined;
    if (areaHint) {
      const areaResult = await this.resolveAreaHint(areaHint, destination);
      entities.push(areaResult.entity);
      if (areaResult.entity.status === 'resolved' && areaResult.candidate) {
        resolvedAreaCandidate = areaResult.candidate;
      } else if (areaResult.entity.rejectionReason) {
        reasons.push(areaResult.entity.rejectionReason);
      }
    }

    const routeScope = resolvedAreaCandidate ?? destination;
    for (const hint of proposal.entityHints.filter(
      (candidate) => candidate.role !== 'area',
    )) {
      const entity = this.isRouteLikeHint(hint)
        ? await this.resolveRouteLikeHint(hint, routeScope)
        : await this.resolveVenueHint(hint, request);
      entities.push(entity);
      if (entity.status !== 'resolved' && entity.rejectionReason) {
        reasons.push(entity.rejectionReason);
      }
    }

    const resolvedCount = entities.filter(
      (entity) => entity.status === 'resolved',
    ).length;
    if (resolvedCount === 0) {
      return this.reject(
        proposal,
        entities,
        reasons.length > 0 ? reasons : ['no_resolved_entities'],
      );
    }

    const unresolvedCount = entities.length - resolvedCount;
    return {
      proposal,
      status: unresolvedCount > 0 ? 'partial' : 'accepted',
      resolvedEntities: entities,
      rejectionReasons: reasons,
    };
  }

  private async resolveAreaHint(
    hint: EntityHint,
    destination: OsmCandidate,
  ): Promise<{ entity: ResolvedEntity; candidate?: OsmCandidate }> {
    if (GENERIC_AREA_PHRASES.has(normalizeName(hint.name))) {
      return { entity: this.rejectedEntity(hint, 'generic_area_hint') };
    }

    const neighborhoodLookup =
      await this.osmPlacesService.lookupNeighborhoodsWithin(destination);
    if (neighborhoodLookup.status === 'failed') {
      return {
        entity: this.unresolvedProviderEntity(
          hint,
          'provider_unavailable',
        ),
      };
    }

    const matches = this.matchByName(hint.name, neighborhoodLookup.value);
    if (matches.length === 1) {
      return {
        entity: this.resolvedOsmEntity(hint, matches[0]),
        candidate: matches[0],
      };
    }
    if (matches.length > 1) {
      return { entity: this.rejectedEntity(hint, 'ambiguous_area') };
    }

    const center = this.centroidOf(destination);
    const named = await this.osmPlacesService.findBoundaryByName(
      hint.name,
      center.latitude,
      center.longitude,
      5_000,
    );
    if (named && this.isCandidateCenterInside(destination, named)) {
      return {
        entity: this.resolvedOsmEntity(hint, named),
        candidate: named,
      };
    }
    return { entity: this.rejectedEntity(hint, 'unresolved_area') };
  }

  private async resolveVenueHint(
    hint: EntityHint,
    request: ProposalResolutionRequest,
  ): Promise<ResolvedEntity> {
    const destination = request.destinationBoundary as OsmCandidate;
    let placesFailed = false;
    try {
      const center = this.centroidOf(destination);
      const result = await this.placesApi.searchText({
        textQuery: `${hint.name}, ${request.destinationName}`,
        locationBias: {
          center,
          radius: 5_000,
        },
        maxResultCount: 5,
      });
      const candidates = result.data ?? [];
      const best = candidates.find((candidate) =>
        this.fuzzyMatches(
          hint.name,
          candidate.displayName?.text ?? candidate.name ?? '',
        ),
      );
      if (best?.id) {
        const validation = this.catalogCandidateValidator.validate(
          this.toCatalogCandidate(best),
          { destinationBoundary: destination.geometry },
        );
        if (validation.accepted) {
          return this.resolvedPlaceEntity(hint, best);
        }
      }
    } catch (error: any) {
      placesFailed = true;
      this.logger.warn(
        `Places resolution failed for hint "${hint.name}": ${error.message}`,
      );
    }

    const osmLookup = await this.osmPlacesService.lookupPoisWithin(destination);
    if (osmLookup.status === 'failed') {
      return placesFailed
        ? this.unresolvedProviderEntity(hint, 'provider_unavailable')
        : this.unresolvedProviderEntity(hint, 'osm_provider_unavailable');
    }
    const matches = this.matchByName(hint.name, osmLookup.value);
    if (matches.length === 1) {
      return this.resolvedOsmEntity(hint, matches[0]);
    }
    if (matches.length > 1) {
      return this.rejectedEntity(hint, 'ambiguous_venue');
    }
    return this.rejectedEntity(hint, 'unresolved_venue');
  }

  private async resolveRouteLikeHint(
    hint: EntityHint,
    scope: OsmCandidate,
  ): Promise<ResolvedEntity> {
    const lookup = await this.osmPlacesService.lookupStreetsWithin(scope);
    if (lookup.status === 'failed') {
      return this.unresolvedProviderEntity(hint, 'osm_provider_unavailable');
    }
    const matches = lookup.value.filter((candidate) =>
      this.routeNameMatches(hint.name, candidate.name),
    );
    if (matches.length === 1) {
      return this.resolvedOsmEntity(hint, matches[0]);
    }
    if (matches.length > 1) {
      return this.rejectedEntity(hint, 'ambiguous_route');
    }
    return this.rejectedEntity(hint, 'unresolved_route');
  }

  private resolvedPlaceEntity(
    hint: EntityHint,
    place: PlaceData,
  ): ResolvedEntity {
    const canonicalName = place.displayName?.text ?? place.name ?? hint.name;
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    return {
      hintKey: hint.key,
      hintName: hint.name,
      role: hint.role,
      expectedType: hint.expectedType,
      status: 'resolved',
      externalId: place.id,
      provider: this.placesApi.provider,
      canonicalName,
      latitude,
      longitude,
      evidence: [
        {
          provider: this.placesApi.provider,
          externalId: place.id,
          canonicalName,
          latitude,
          longitude,
        },
      ],
      materialization: { kind: 'place', place },
    };
  }

  private resolvedOsmEntity(
    hint: EntityHint,
    candidate: OsmCandidate,
  ): ResolvedEntity {
    const center = this.centroidOf(candidate);
    return {
      hintKey: hint.key,
      hintName: hint.name,
      role: hint.role,
      expectedType: hint.expectedType,
      status: 'resolved',
      externalId: candidate.id,
      provider: 'osm',
      canonicalName: candidate.name,
      latitude: center.latitude,
      longitude: center.longitude,
      geometry: candidate.geometry,
      adminContext: this.adminContextOf(candidate),
      evidence: [
        {
          provider: 'osm',
          externalId: candidate.id,
          canonicalName: candidate.name,
          latitude: center.latitude,
          longitude: center.longitude,
        },
      ],
      materialization: { kind: 'osm', candidate },
    };
  }

  private adminContextOf(candidate: OsmCandidate): ResolvedEntityAdminContext {
    const tags = candidate.tags;
    return {
      locality:
        tags['addr:city'] ?? tags.city ?? tags.town ?? tags.village ?? undefined,
      municipality:
        tags['addr:municipality'] ?? tags.municipality ?? undefined,
      region:
        tags['addr:state'] ?? tags.state ?? tags.region ?? tags.province ?? undefined,
      country: tags['addr:country'] ?? tags.country ?? undefined,
    };
  }

  private rejectedEntity(hint: EntityHint, reason: string): ResolvedEntity {
    return {
      hintKey: hint.key,
      hintName: hint.name,
      role: hint.role,
      expectedType: hint.expectedType,
      status: 'rejected',
      rejectionReason: reason,
    };
  }

  private unresolvedProviderEntity(
    hint: EntityHint,
    reason: string,
  ): ResolvedEntity {
    return {
      hintKey: hint.key,
      hintName: hint.name,
      role: hint.role,
      expectedType: hint.expectedType,
      status: 'unresolved',
      rejectionReason: reason,
      providerFailure: true,
    };
  }

  private resolvedProposal(
    proposal: ActivityProposal,
    resolvedEntities: ResolvedEntity[],
  ): ResolvedActivityProposal {
    return {
      proposal,
      status: 'accepted',
      resolvedEntities,
      rejectionReasons: [],
    };
  }

  private reject(
    proposal: ActivityProposal,
    resolvedEntities: ResolvedEntity[],
    rejectionReasons: string[],
  ): ResolvedActivityProposal {
    return {
      proposal,
      status: 'rejected',
      resolvedEntities,
      rejectionReasons: Array.from(new Set(rejectionReasons.filter(Boolean))),
    };
  }

  private toCatalogCandidate(place: PlaceData): CatalogCandidate {
    return {
      provider: this.placesApi.provider,
      externalId: place.id,
      name: place.displayName?.text ?? place.name ?? '',
      latitude: place.location?.latitude,
      longitude: place.location?.longitude,
      providerTypes: place.types ?? [],
      providerPrimaryType: place.primaryType,
      formattedAddress: place.formattedAddress,
      businessStatus: place.businessStatus,
      rating: place.rating,
      ratingCount: place.userRatingCount,
    };
  }

  private isRouteLikeHint(hint: EntityHint): boolean {
    return (
      hint.role === 'route' ||
      ROUTE_LIKE_TYPES.has(normalizeName(hint.expectedType))
    );
  }

  private matchByName(
    hint: string,
    candidates: OsmCandidate[],
  ): OsmCandidate[] {
    return candidates.filter((candidate) =>
      this.fuzzyMatches(hint, candidate.name),
    );
  }

  private routeNameMatches(hint: string, candidate: string): boolean {
    if (this.fuzzyMatches(hint, candidate)) return true;
    const normalizedHint = normalizeRouteName(hint);
    const normalizedCandidate = normalizeRouteName(candidate);
    if (!normalizedHint || !normalizedCandidate) return false;
    if (normalizedHint === normalizedCandidate) return true;
    const shorter =
      normalizedHint.length <= normalizedCandidate.length
        ? normalizedHint
        : normalizedCandidate;
    const longer =
      normalizedHint.length > normalizedCandidate.length
        ? normalizedHint
        : normalizedCandidate;
    return shorter.length >= 8 && longer.includes(shorter);
  }

  private fuzzyMatches(left: string, right: string): boolean {
    const normalizedLeft = normalizeName(left);
    const normalizedRight = normalizeName(right);
    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft === normalizedRight) return true;
    if (normalizedLeft.length < 5 || normalizedRight.length < 5) return false;
    return levenshtein(normalizedLeft, normalizedRight) <= 1;
  }

  private centroidOf(candidate: OsmCandidate): {
    latitude: number;
    longitude: number;
  } {
    const geometry = candidate.geometry;
    if (geometry.type === 'Point') {
      return {
        latitude: geometry.coordinates[1],
        longitude: geometry.coordinates[0],
      };
    }
    const ring: [number, number][] =
      geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.coordinates[0][0];
    return {
      latitude: ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length,
      longitude: ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length,
    };
  }

  private isCandidateCenterInside(
    container: OsmCandidate,
    candidate: OsmCandidate,
  ): boolean {
    const center = this.centroidOf(candidate);
    const geometry = container.geometry;
    if (geometry.type === 'Point') return false;
    // resolveAreaHint only calls this for polygonal destination boundaries.
    const polygons =
      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some((polygon) =>
      pointInRing(center.longitude, center.latitude, polygon[0]),
    );
  }
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeRouteName(value: string): string {
  return normalizeName(value)
    .replace(
      /^(calle|street|st|avenida|avenue|av|avda|boulevard|bulevar|blvd|paseo|promenade|boardwalk|riverwalk|waterfront)\s+/,
      '',
    )
    .replace(/\bgral\b/g, 'general')
    .replace(/\bpte\b/g, 'presidente')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(left: string, right: string): number {
  const matrix: number[][] = Array.from(
    { length: left.length + 1 },
    (_, index) => [index, ...Array(right.length).fill(0)],
  );
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }
  return matrix[left.length][right.length];
}

function pointInRing(
  longitude: number,
  latitude: number,
  ring: [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > latitude !== yj > latitude &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
