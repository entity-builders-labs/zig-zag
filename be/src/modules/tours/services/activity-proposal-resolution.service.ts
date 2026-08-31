import { Inject, Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityKind, Prisma, VariantTheme } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { CatalogCandidateValidatorService } from '@activities/services/catalog-candidate-validator.service';
import { CatalogCandidate } from '@activities/interfaces/catalog-candidate-validation.interface';
import {
  OsmPlacesService,
  OsmCandidate,
} from '@integrations/osm/services/osm-places.service';
import { OsmMembershipService } from '@integrations/osm/services/osm-membership.service';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  IPlacesApiService,
  PlaceData,
} from '@integrations/google-places/interfaces/places-api.interface';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import {
  ActivityProposal,
  EntityHint,
  ProposalKind,
} from '../interfaces/activity-discovery.interface';
import {
  ProposalResolutionRequest,
  ProposalResolutionResponse,
  ResolvedActivityProposal,
  ResolvedEntity,
} from '../interfaces/proposal-resolution.interface';
import { MIN_WAYPOINTS_FOR_MULTI_STOP } from '../utils/composite-activity-verification.util';

const THEME_TO_VARIANT: Record<string, VariantTheme> = {
  history: VariantTheme.HISTORY,
  historic: VariantTheme.HISTORY,
  heritage: VariantTheme.HISTORY,
  culture: VariantTheme.HISTORY,
  landmark: VariantTheme.HISTORY,
  landmarks: VariantTheme.HISTORY,
  art: VariantTheme.ART,
  arts: VariantTheme.ART,
  food: VariantTheme.FOOD,
  foodie: VariantTheme.FOOD,
  gastronomy: VariantTheme.FOOD,
  tapas: VariantTheme.FOOD,
  nature: VariantTheme.NATURE,
  outdoor: VariantTheme.NATURE,
  outdoors: VariantTheme.NATURE,
  architecture: VariantTheme.ARCHITECTURE,
  nightlife: VariantTheme.NIGHTLIFE,
  shopping: VariantTheme.SHOPPING,
  family: VariantTheme.FAMILY,
  tango: VariantTheme.TANGO,
  photography: VariantTheme.PHOTOGRAPHY,
  photo: VariantTheme.PHOTOGRAPHY,
  quick: VariantTheme.QUICK,
  'deep dive': VariantTheme.DEEP_DIVE,
  'deep-dive': VariantTheme.DEEP_DIVE,
};

const THEME_NAME: Record<VariantTheme, string> = {
  HISTORY: 'Historic',
  ART: 'Art',
  FOOD: 'Food',
  NATURE: 'Nature',
  ARCHITECTURE: 'Architecture',
  NIGHTLIFE: 'Nightlife',
  SHOPPING: 'Shopping',
  FAMILY: 'Family',
  TANGO: 'Tango',
  PHOTOGRAPHY: 'Photography',
  QUICK: 'Quick',
  DEEP_DIVE: 'Deep Dive',
};

const GENERIC_AREA_PHRASES = new Set([
  'downtown',
  'city center',
  'city centre',
  'centre',
  'center',
  'old town',
]);

const STREET_TYPES = new Set([
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
]);

const KIND_MAP: Record<ProposalKind, ActivityKind> = {
  POI: ActivityKind.POI,
  ROUTE: ActivityKind.ROUTE,
  AREA: ActivityKind.AREA,
  NEIGHBORHOOD_WALK: ActivityKind.NEIGHBORHOOD_WALK,
  EXPERIENCE: ActivityKind.EXPERIENCE,
};

/**
 * PR 8: turns grounded `ActivityProposal` concepts into real, reusable
 * Activities only after every required entity is resolved through the
 * authoritative provider (Google Places for POIs/venues, OSM for
 * areas/routes/streets) and validated against the destination boundary.
 *
 * Discovery proposes meaning; this service supplies identity and authorizes
 * persistence through CompositeActivityService — it never trusts a free-text
 * name, an LLM coordinate, or embedding similarity as identity proof.
 */
@Injectable()
export class ActivityProposalResolutionService {
  private readonly logger = new Logger(ActivityProposalResolutionService.name);

  constructor(
    @Inject('PlacesApiService')
    private readonly placesApi: IPlacesApiService,
    private readonly osmPlacesService: OsmPlacesService,
    private readonly osmMembershipService: OsmMembershipService,
    private readonly compositeActivityService: CompositeActivityService,
    private readonly catalogCandidateValidator: CatalogCandidateValidatorService,
    private readonly prisma: PrismaService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  async resolve(
    request: ProposalResolutionRequest,
  ): Promise<ProposalResolutionResponse> {
    const resolved: ResolvedActivityProposal[] = [];
    for (const proposal of request.proposals) {
      resolved.push(await this.resolveProposal(proposal, request));
    }

    await this.indexResolvedVenues(resolved);

    const acceptedCount = resolved.filter(
      (r) => r.status === 'accepted',
    ).length;
    const rejectedCount = resolved.filter(
      (r) => r.status === 'rejected',
    ).length;
    return {
      resolved,
      totalProposals: request.proposals.length,
      acceptedCount,
      rejectedCount,
    };
  }

  /**
   * POI venues persisted directly by this service (standalone POI proposals
   * and composite waypoints) never go through CompositeActivityService's own
   * embedding step, so without this they'd sit permanently un-embedded and
   * get demoted behind the semantically-ranked group by candidate ranking,
   * regardless of quality or relevance — found live-testing PR 8 (a real
   * landmark never surfaced across three separate generations).
   */
  private async indexResolvedVenues(
    resolved: ResolvedActivityProposal[],
  ): Promise<void> {
    const activityIds = new Set<string>();
    for (const proposal of resolved) {
      for (const entity of proposal.resolvedEntities) {
        if (
          entity.role === 'venue' &&
          entity.status === 'resolved' &&
          entity.activityId
        ) {
          activityIds.add(entity.activityId);
        }
      }
    }
    if (activityIds.size === 0) return;

    try {
      const result = await this.vectorStoreService.saveActivityEmbedding(
        Array.from(activityIds, (id) => ({ id })),
      );
      if (result.status === 'unavailable') {
        this.logger.warn(
          `Embedding unavailable for resolved venues: ${result.reason}`,
        );
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to index embeddings for resolved venues: ${error.message}`,
      );
    }
  }

  private async resolveProposal(
    proposal: ActivityProposal,
    request: ProposalResolutionRequest,
  ): Promise<ResolvedActivityProposal> {
    if (!request.destinationBoundary) {
      return this.reject(proposal, [], ['missing_destination_boundary']);
    }
    const destination = request.destinationBoundary;

    switch (proposal.kind) {
      case 'AREA':
        return this.resolveAreaProposal(proposal, destination);
      case 'POI':
        return this.resolvePoiProposal(proposal, destination, request);
      case 'ROUTE':
      case 'NEIGHBORHOOD_WALK':
      case 'EXPERIENCE':
        return this.resolveCompositeProposal(proposal, destination, request);
      default:
        return this.reject(proposal, [], ['unknown_kind']);
    }
  }

  // ── Proposal-level resolution ─────────────────────────────────────

  private async resolveAreaProposal(
    proposal: ActivityProposal,
    destination: OsmCandidate,
  ): Promise<ResolvedActivityProposal> {
    const areaHint = proposal.entityHints.find((h) => h.role === 'area');
    if (!areaHint) {
      return this.reject(proposal, [], ['missing_required_hint']);
    }

    const { entity, candidate } = await this.resolveAreaHint(
      areaHint,
      destination,
    );
    if (!candidate) {
      return this.reject(
        proposal,
        [entity],
        [entity.rejectionReason as string],
      );
    }

    const area = await this.compositeActivityService.resolveArea(candidate);
    return {
      proposal,
      status: 'accepted',
      resolvedEntities: [entity],
      rejectionReasons: [],
      persistedActivityId: area.id,
    };
  }

  private async resolvePoiProposal(
    proposal: ActivityProposal,
    destination: OsmCandidate,
    request: ProposalResolutionRequest,
  ): Promise<ResolvedActivityProposal> {
    const venueHint = proposal.entityHints.find((h) => h.role === 'venue');
    if (!venueHint) {
      return this.reject(proposal, [], ['missing_required_hint']);
    }

    const { entity, activity } = await this.resolveVenueHint(
      venueHint,
      destination,
      request,
    );
    if (!activity) {
      return this.reject(
        proposal,
        [entity],
        [entity.rejectionReason as string],
      );
    }

    return {
      proposal,
      status: 'accepted',
      resolvedEntities: [entity],
      rejectionReasons: [],
      persistedActivityId: activity.id,
    };
  }

  private async resolveCompositeProposal(
    proposal: ActivityProposal,
    destination: OsmCandidate,
    request: ProposalResolutionRequest,
  ): Promise<ResolvedActivityProposal> {
    const resolvedEntities: ResolvedEntity[] = [];
    const rejectionReasons: string[] = [];
    const kind = KIND_MAP[proposal.kind];

    if (kind === ActivityKind.NEIGHBORHOOD_WALK) {
      const hasRequiredArea = proposal.entityHints.some(
        (h) => h.role === 'area' && h.required,
      );
      if (!hasRequiredArea) {
        return this.reject(proposal, resolvedEntities, [
          'missing_required_area_hint',
        ]);
      }
    }
    if (kind === ActivityKind.ROUTE) {
      const hasRequiredRoute = proposal.entityHints.some(
        (h) => h.role === 'route' && h.required,
      );
      if (!hasRequiredRoute) {
        return this.reject(proposal, resolvedEntities, [
          'missing_required_route_hint',
        ]);
      }
    }
    // EXPERIENCE has no upfront presence gate — its sufficiency depends on
    // resolution results below, not just hint presence.

    const areaHint = proposal.entityHints.find((h) => h.role === 'area');
    let resolvedArea: OsmCandidate | null = null;
    if (areaHint) {
      const areaResult = await this.resolveAreaHint(areaHint, destination);
      resolvedEntities.push(areaResult.entity);
      if (!areaResult.candidate) {
        rejectionReasons.push(areaResult.entity.rejectionReason as string);
        return this.reject(proposal, resolvedEntities, rejectionReasons);
      }
      resolvedArea = areaResult.candidate;
    }
    const scopeBoundary = resolvedArea ?? destination;

    const otherHints = proposal.entityHints.filter((h) => h.role !== 'area');

    const waypointIds: string[] = [];
    const candidateOsmFeaturesById = new Map<string, OsmCandidate>();
    const seenExternalIds = new Set<string>();

    for (const hint of otherHints) {
      if (hint.role === 'route' || this.isStreetHint(hint)) {
        const street = await this.resolveStreetHint(hint, scopeBoundary);
        resolvedEntities.push(street.entity);
        if (!street.candidate) {
          rejectionReasons.push(street.entity.rejectionReason as string);
          continue;
        }
        if (seenExternalIds.has(street.candidate.id)) {
          rejectionReasons.push('duplicate_entity');
          continue;
        }
        seenExternalIds.add(street.candidate.id);
        candidateOsmFeaturesById.set(street.candidate.id, street.candidate);
        waypointIds.push(street.candidate.id);
      } else {
        const venue = await this.resolveVenueHint(hint, destination, request);
        resolvedEntities.push(venue.entity);
        if (!venue.activity) {
          rejectionReasons.push(venue.entity.rejectionReason as string);
          continue;
        }

        const membership = this.osmMembershipService.membershipOf(
          venue.entity.latitude as number,
          venue.entity.longitude as number,
          [scopeBoundary],
        );
        if (membership.outcome !== 'inside') {
          rejectionReasons.push('waypoint_outside_neighborhood');
          continue;
        }

        if (seenExternalIds.has(venue.activity.id)) {
          rejectionReasons.push('duplicate_entity');
          continue;
        }
        seenExternalIds.add(venue.activity.id);
        waypointIds.push(venue.activity.id);
      }
    }

    if (kind === ActivityKind.ROUTE) {
      const hasOsmGeometry = waypointIds.some((id) =>
        candidateOsmFeaturesById.has(id),
      );
      if (waypointIds.length === 0 || !hasOsmGeometry) {
        rejectionReasons.push('route_geometry_missing');
        return this.reject(proposal, resolvedEntities, rejectionReasons);
      }
    } else if (kind === ActivityKind.EXPERIENCE) {
      const requiredOtherHints = otherHints.filter((h) => h.required);
      const isVenueCentric =
        requiredOtherHints.length === 1 &&
        requiredOtherHints[0].role === 'venue';
      const minRequired = isVenueCentric ? 1 : MIN_WAYPOINTS_FOR_MULTI_STOP;
      if (waypointIds.length < minRequired) {
        rejectionReasons.push('insufficient_experience_entities');
        return this.reject(proposal, resolvedEntities, rejectionReasons);
      }
    } else {
      const poiCount = waypointIds.filter(
        (id) => !candidateOsmFeaturesById.has(id),
      ).length;
      if (poiCount < MIN_WAYPOINTS_FOR_MULTI_STOP) {
        rejectionReasons.push('insufficient_waypoints');
        return this.reject(proposal, resolvedEntities, rejectionReasons);
      }
    }

    const variantTheme = this.pickVariantTheme(proposal.themes);
    if (!variantTheme) {
      rejectionReasons.push('unresolvable_theme');
      return this.reject(proposal, resolvedEntities, rejectionReasons);
    }

    const areaForPersistence = resolvedArea ?? destination;

    try {
      const variant =
        await this.compositeActivityService.createOrReuseComposite({
          name: this.canonicalName(areaForPersistence.name, variantTheme, kind),
          kind,
          variantTheme,
          themeReasoning: proposal.shortReason,
          areaCandidate: areaForPersistence,
          waypointIds,
          candidateOsmFeaturesById,
        });
      return {
        proposal,
        status: 'accepted',
        resolvedEntities,
        rejectionReasons,
        persistedActivityId: variant.id,
      };
    } catch (error: any) {
      this.logger.warn(
        `Failed to persist composite "${proposal.name}": ${error.message}`,
      );
      rejectionReasons.push('persistence_failed');
      return this.reject(proposal, resolvedEntities, rejectionReasons);
    }
  }

  // ── Hint resolution ───────────────────────────────────────────────

  private async resolveAreaHint(
    hint: EntityHint,
    destination: OsmCandidate,
  ): Promise<{ entity: ResolvedEntity; candidate: OsmCandidate | null }> {
    if (GENERIC_AREA_PHRASES.has(normalizeName(hint.name))) {
      return {
        entity: this.rejectedEntity(hint, 'generic_area_hint'),
        candidate: null,
      };
    }

    // 1. Real neighborhoods inside the destination — the only place a
    //    proposal's neighborhood may resolve. This is what prevents a Triana
    //    proposal from resolving to a same-named area in another city.
    const neighborhoods =
      await this.osmPlacesService.findNeighborhoodsWithin(destination);
    const matches = this.matchByName(hint.name, neighborhoods);
    if (matches.length === 1) {
      return {
        entity: this.resolvedOsmEntity(hint, matches[0]),
        candidate: matches[0],
      };
    }
    if (matches.length > 1) {
      return {
        entity: this.rejectedEntity(hint, 'ambiguous_area'),
        candidate: null,
      };
    }

    // 2. Boundary-by-name fallback, then prove containment in the destination.
    const center = this.centroidOf(destination.geometry);
    const named = await this.osmPlacesService.findBoundaryByName(
      hint.name,
      center.latitude,
      center.longitude,
      5000,
    );
    if (named && this.isInside(destination, named)) {
      return { entity: this.resolvedOsmEntity(hint, named), candidate: named };
    }

    return {
      entity: this.rejectedEntity(hint, 'unresolved_area'),
      candidate: null,
    };
  }

  private async resolveVenueHint(
    hint: EntityHint,
    destination: OsmCandidate,
    request: ProposalResolutionRequest,
  ): Promise<{ entity: ResolvedEntity; activity: Activity | null }> {
    try {
      const center = this.centroidOf(destination.geometry);
      const result = await this.placesApi.searchText({
        textQuery: `${hint.name}, ${request.destinationName}`,
        locationBias: {
          center: { latitude: center.latitude, longitude: center.longitude },
          radius: 5000,
        },
        maxResultCount: 5,
      });

      const candidates = result.data ?? [];
      const best =
        candidates.find((c) =>
          this.fuzzyMatches(hint.name, c.displayName?.text ?? c.name ?? ''),
        ) ?? candidates[0];

      if (!best || !best.id) {
        return {
          entity: this.rejectedEntity(hint, 'unresolved_venue'),
          activity: null,
        };
      }

      const validation = this.catalogCandidateValidator.validate(
        this.toCatalogCandidate(best),
        { destinationBoundary: destination.geometry },
      );
      if (!validation.accepted) {
        return {
          entity: this.rejectedEntity(
            hint,
            validation.rejectionReasons.length > 0
              ? `invalid_venue:${validation.rejectionReasons.join(',')}`
              : 'invalid_venue',
          ),
          activity: null,
        };
      }

      const activity = await this.resolvePoiActivity(best);
      return {
        entity: {
          hintKey: hint.key,
          hintName: hint.name,
          role: hint.role,
          expectedType: hint.expectedType,
          status: 'resolved',
          activityId: activity.id,
          externalId: best.id,
          provider: this.placesApi.provider,
          latitude: best.location?.latitude,
          longitude: best.location?.longitude,
        },
        activity,
      };
    } catch (error: any) {
      this.logger.warn(
        `Places resolution failed for hint "${hint.name}": ${error.message}`,
      );
      return {
        entity: this.rejectedEntity(hint, 'unresolved_venue'),
        activity: null,
      };
    }
  }

  private async resolveStreetHint(
    hint: EntityHint,
    neighborhood: OsmCandidate,
  ): Promise<{ entity: ResolvedEntity; candidate: OsmCandidate | null }> {
    const streets = await this.osmPlacesService.findStreetsWithin(neighborhood);
    const matches = streets.filter((candidate) =>
      this.streetNameMatches(hint.name, candidate.name),
    );
    if (matches.length === 1) {
      return {
        entity: this.resolvedOsmEntity(hint, matches[0]),
        candidate: matches[0],
      };
    }
    if (matches.length > 1) {
      return {
        entity: this.rejectedEntity(hint, 'ambiguous_street'),
        candidate: null,
      };
    }
    return {
      entity: this.rejectedEntity(hint, 'unresolved_street'),
      candidate: null,
    };
  }

  // ── POI persistence ───────────────────────────────────────────────

  private async resolvePoiActivity(place: PlaceData): Promise<Activity> {
    const provider = this.placesApi.provider;
    const sourceName = provider === 'geoapify' ? 'geoapify' : 'google-maps';
    const baseUrl =
      provider === 'geoapify'
        ? 'https://www.geoapify.com'
        : 'https://maps.google.com';
    const sourceId = await this.ensureSource(sourceName, 'external', baseUrl);
    const externalId = place.id;
    const primaryType = place.primaryType ?? place.types?.[0] ?? undefined;

    return this.findOrCreateWithRace(
      () =>
        this.prisma.activity.findUnique({
          where: { sourceId_externalId: { sourceId, externalId } },
        }),
      () =>
        this.prisma.activity.create({
          data: {
            name: place.displayName?.text ?? place.name ?? '',
            kind: ActivityKind.POI,
            type: primaryType,
            latitude: place.location?.latitude,
            longitude: place.location?.longitude,
            formattedAddress: place.formattedAddress,
            rating: place.rating,
            ratingCount: place.userRatingCount,
            source: { connect: { id: sourceId } },
            externalId,
            metadata: {
              placesProvider: provider,
              providerTypes: place.types ?? [],
              providerPrimaryType: place.primaryType,
            } as unknown as Prisma.InputJsonValue,
          },
        }),
    );
  }

  // ── Small persistence primitives ──────────────────────────────────

  private async findOrCreateWithRace<T>(
    find: () => Promise<T | null>,
    create: () => Promise<T>,
  ): Promise<T> {
    const existing = await find();
    if (existing) return existing;
    try {
      return await create();
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const retried = await find();
        if (retried) return retried;
      }
      throw error;
    }
  }

  private async ensureSource(
    name: string,
    type: string,
    baseUrl?: string,
  ): Promise<string> {
    const source = await this.findOrCreateWithRace(
      () => this.prisma.source.findUnique({ where: { name } }),
      () => this.prisma.source.create({ data: { name, type, baseUrl } }),
    );
    return source.id;
  }

  // ── Validation helpers ────────────────────────────────────────────

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

  private isStreetHint(hint: EntityHint): boolean {
    if (hint.role === 'route') return true;
    return STREET_TYPES.has(normalizeName(hint.expectedType));
  }

  private isInside(container: OsmCandidate, candidate: OsmCandidate): boolean {
    const center = this.centroidOf(candidate.geometry);
    return geometryContainsPoint(
      container.geometry,
      center.longitude,
      center.latitude,
    );
  }

  private pickVariantTheme(themes: string[]): VariantTheme | null {
    for (const theme of themes) {
      const mapped = THEME_TO_VARIANT[normalizeName(theme)];
      if (mapped) return mapped;
    }
    return null;
  }

  private canonicalName(
    areaName: string,
    theme: VariantTheme,
    kind: ActivityKind,
  ): string {
    const suffix =
      kind === ActivityKind.ROUTE
        ? 'Route'
        : kind === ActivityKind.EXPERIENCE
          ? 'Experience'
          : 'Walk';
    return `${areaName} ${THEME_NAME[theme]} ${suffix}`;
  }

  private matchByName(
    hint: string,
    candidates: OsmCandidate[],
  ): OsmCandidate[] {
    return candidates.filter((c) => this.fuzzyMatches(hint, c.name));
  }

  private streetNameMatches(hint: string, candidate: string): boolean {
    if (this.fuzzyMatches(hint, candidate)) return true;

    const normalizedHint = normalizeStreetName(hint);
    const normalizedCandidate = normalizeStreetName(candidate);
    if (!normalizedHint || !normalizedCandidate) return false;
    if (normalizedHint === normalizedCandidate) return true;

    // Search evidence often includes a locality qualifier while OSM keeps
    // only the canonical way name (for example "Costanera de Gualeguaychú"
    // vs "Costanera"). Accept containment only for reasonably specific
    // names; if more than one OSM way matches we still reject as ambiguous.
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

  private fuzzyMatches(a: string, b: string): boolean {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.length < 5 || nb.length < 5) return false;
    return levenshtein(na, nb) <= 1;
  }

  private centroidOf(geometry: GeoJsonGeometry): {
    latitude: number;
    longitude: number;
  } {
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
    const longitude = ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length;
    const latitude = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    return { latitude, longitude };
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

  private resolvedOsmEntity(
    hint: EntityHint,
    candidate: OsmCandidate,
  ): ResolvedEntity {
    const center = this.centroidOf(candidate.geometry);
    return {
      hintKey: hint.key,
      hintName: hint.name,
      role: hint.role,
      expectedType: hint.expectedType,
      status: 'resolved',
      externalId: candidate.id,
      provider: 'osm',
      latitude: center.latitude,
      longitude: center.longitude,
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
      rejectionReasons,
    };
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

function normalizeStreetName(value: string): string {
  return normalizeName(value)
    .replace(/^(calle|street|st|avenida|avenue|av|avda|boulevard|bulevar|blvd)\s+/, '')
    .replace(/\bgral\b/g, 'general')
    .replace(/\bpte\b/g, 'presidente')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}
