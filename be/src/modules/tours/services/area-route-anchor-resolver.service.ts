import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DestinationCompatibility,
  evaluateDestinationCompatibility,
} from '../utils/destination-compatibility.policy';
import {
  buildRouteClusterCandidate,
  structuredRouteEvidence,
} from '../utils/route-cluster-candidate.util';
import { TargetedRouteResolverService } from './targeted-route-resolver.service';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmPlacesService,
  OsmCandidate,
} from '@integrations/osm/services/osm-places.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { INominatimApiService } from '@integrations/osm/interfaces/nominatim.interface';
import { IPlacesApiService } from '@integrations/google-places/interfaces/places-api.interface';
import { Coordinates } from '@shared/utils/distance.utils';
import {
  AnchorCandidateFact,
  InterpretedAnchor,
  ResolvedAnchor,
} from '../interfaces/preference-spec.interface';
import {
  EntityCandidate,
  GeographicScope,
  IdentityEvidence,
  VerificationDecision,
} from '../interfaces/experience-resolution.interface';
import { ExperienceCatalogService } from './experience-catalog.service';
import {
  bestNominatimMatch,
  candidateMatchCountToMultiplicity,
  countNominatimExactMatches,
  extractWikidataQid,
  isAreaScaleEligible,
  normalizeGeoName,
  countExactNormalizedMatches,
} from '../utils/nominatim-match.util';
import {
  placesAcquisitionLabel,
  canonicalPlacesExternalId,
} from '../utils/places-external-identity.util';
import { buildLocalIdentityEvidence } from '../utils/identity-evidence-builder.util';
import { IdentityVerifier } from './identity-verifier.service';
import { IdentityEvidenceCollector } from './identity-evidence-collector.service';
import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';

/**
 * Task B5 — resolves a single AREA/ROUTE anchor to a real, persisted
 * GeoEntity using the same trusted providers (Nominatim/Overpass) and the
 * same real name-matching semantics (`nominatim-match.util.ts`) the
 * resolver itself already uses — never invents geometry, and any missing
 * step is a NORMAL `{resolved: false}` outcome, not a failure.
 */
export type AnchorGeometryResolution =
  | {
      resolved: true;
      status: 'match';
      kind: 'area' | 'route';
      geoEntityId: string;
      canonicalName?: string;
      provider?: string;
      externalId?: string;
      // The raw geometry already in hand at upsert time -- feeds
      // ExperienceValidationScope.geometry directly, no extra DB
      // round-trip.
      geometry: GeoJsonGeometry;
    }
  | { resolved: false; status: 'no_match' | 'unavailable'; reason?: string };

interface AnchorGeoCandidate {
  kind: 'area' | 'route' | 'venue';
  canonicalName: string;
  provider: string;
  externalId: string;
  geometry: GeoJsonGeometry;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, string>;
  placeTypes?: string[];
  nameEvidenceMultiplicity: {
    exactName: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
    declaredAlias: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
  };
  // Task A6 -- only set by discoverArea, for the real OSM way/relation
  // boundary lookupBoundaryById already returned.
  osmBoundary?: OsmCandidate;
  /**
   * Only set by discoverRoute: the canonical multi-identity ROUTE candidate
   * (shared `buildRouteClusterCandidate`) and the typed structural fact
   * IdentityVerifier judges it by.
   */
  routeEntity?: EntityCandidate;
  acquisitionEvidence?: IdentityEvidence[];
}

type CandidateDiscovery =
  | {
      status: 'match';
      candidate: AnchorGeoCandidate;
      /**
       * Canonical destination-compatibility fact for the discovered
       * candidate (single policy authority: the shared
       * evaluateDestinationCompatibility primitive).
       */
      compatibility: DestinationCompatibility;
    }
  | {
      /**
       * A real candidate WAS discovered but the canonical destination-
       * compatibility policy excluded it (Bitácora F1): never selectable,
       * kept as a bounded rejected fact for the Bitácora.
       */
      status: 'rejected';
      reason: 'DESTINATION_INCOMPATIBLE';
      candidate: AnchorGeoCandidate;
      compatibility: DestinationCompatibility;
    }
  | { status: 'no_match'; reason: string }
  | { status: 'unavailable'; reason: string };

const ANCHOR_DISCOVERY_BRANCHES = ['area', 'route', 'place'] as const;

/** Selection-ambiguity identity key: canonical kind + normalized name. */
function candidateIdentityKey(candidate: AnchorGeoCandidate): string {
  return `${candidate.kind}:${normalizeGeoName(candidate.canonicalName)}`;
}

/**
 * Bounded per-branch discovery facts for the Bitácora (F3): what each
 * branch matched, was rejected by the canonical destination-compatibility
 * policy, found nothing, or could not ask its provider -- plus what the
 * selection decided. Deterministic audit output only.
 */
function buildAnchorCandidateFacts(
  outcomes: ReadonlyArray<CandidateDiscovery>,
  selected: CandidateDiscovery | undefined,
  ambiguous: boolean,
  verificationFailed: boolean,
): AnchorCandidateFact[] {
  return outcomes.map((outcome, index) => {
    const branch = ANCHOR_DISCOVERY_BRANCHES[index] ?? 'place';
    if (outcome.status === 'match') {
      const isSelected = outcome === selected;
      return {
        branch,
        discoveryStatus: outcome.status,
        eligibility: 'ELIGIBLE' as const,
        decision: isSelected
          ? verificationFailed
            ? ('IDENTITY_NOT_VERIFIED' as const)
            : ('SELECTED' as const)
          : ambiguous
            ? ('AMBIGUOUS_IDENTITY' as const)
            : ('NOT_SELECTED' as const),
        canonicalName: outcome.candidate.canonicalName,
        kind: outcome.candidate.kind,
        provider: outcome.candidate.provider,
        ...(outcome.candidate.externalId
          ? { externalId: outcome.candidate.externalId }
          : {}),
        compatibility: {
          verdict: outcome.compatibility.verdict,
          reason: outcome.compatibility.reason,
        },
      };
    }
    if (outcome.status === 'rejected') {
      return {
        branch,
        discoveryStatus: outcome.status,
        eligibility: 'REJECTED_DESTINATION_INCOMPATIBLE' as const,
        canonicalName: outcome.candidate.canonicalName,
        kind: outcome.candidate.kind,
        provider: outcome.candidate.provider,
        ...(outcome.candidate.externalId
          ? { externalId: outcome.candidate.externalId }
          : {}),
        compatibility: {
          verdict: outcome.compatibility.verdict,
          reason: outcome.compatibility.reason,
        },
        discoveryReason: outcome.reason,
      };
    }
    return {
      branch,
      discoveryStatus: outcome.status,
      eligibility:
        outcome.status === 'unavailable'
          ? ('PROVIDER_UNAVAILABLE' as const)
          : ('NO_CANDIDATE' as const),
      discoveryReason: outcome.reason,
    };
  });
}

const NON_VENUE_PLACE_TYPES = new Set([
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'country',
  'locality',
  'neighborhood',
  'political',
  'postal_code',
  'premise',
  'route',
  'street_address',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'sublocality_level_3',
  'sublocality_level_4',
  'sublocality_level_5',
]);

function hasCrediblePlaceType(place: {
  primaryType?: string;
  types?: string[];
}): boolean {
  const types = [place.primaryType, ...(place.types ?? [])]
    .filter((type): type is string => typeof type === 'string')
    .map((type) => type.trim().toLowerCase())
    .filter(Boolean);
  return (
    types.length > 0 && types.some((type) => !NON_VENUE_PLACE_TYPES.has(type))
  );
}

function representativePoint(
  geometry: GeoJsonGeometry,
): { latitude: number; longitude: number } | undefined {
  if (geometry.type === 'Point') {
    return {
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    };
  }
  const coordinates: Array<[number, number]> =
    geometry.type === 'LineString'
      ? geometry.coordinates
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates.flat()
        : geometry.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry.type === 'MultiPolygon'
            ? (geometry.coordinates[0]?.[0] ?? [])
            : [];
  if (coordinates.length === 0) return undefined;
  return {
    latitude:
      coordinates.reduce((sum, [, latitude]) => sum + latitude, 0) /
      coordinates.length,
    longitude:
      coordinates.reduce((sum, [longitude]) => sum + longitude, 0) /
      coordinates.length,
  };
}

@Injectable()
export class AreaRouteAnchorResolverService {
  private readonly identityVerifier: IdentityVerifier;
  private readonly identityEvidenceCollector: IdentityEvidenceCollector;
  private readonly targetedRouteResolver: TargetedRouteResolverService;

  constructor(
    private readonly osmPlaces: OsmPlacesService,
    private readonly catalog: ExperienceCatalogService,
    @Optional()
    @Inject('NominatimApiService')
    private readonly nominatim?: INominatimApiService,
    @Optional()
    @Inject('PlacesApiService')
    private readonly placesApi?: IPlacesApiService,
    @Optional()
    @Inject('WikidataApiService')
    private readonly wikidata?: IWikidataApiService,
  ) {
    this.identityVerifier = new IdentityVerifier();
    this.identityEvidenceCollector = new IdentityEvidenceCollector(wikidata);
    this.targetedRouteResolver = new TargetedRouteResolverService(osmPlaces);
  }

  /** Resolve interpreted names to canonical GeoEntity kinds. */
  async resolveNamedAnchors(
    anchors: InterpretedAnchor[],
    options: {
      destinationCountryCode?: string;
      destinationPoint?: Coordinates;
      geographicScope: GeographicScope;
    },
  ): Promise<ResolvedAnchor[]> {
    return Promise.all(
      anchors.map(async (anchor): Promise<ResolvedAnchor> => {
        // Usage is linguistic evidence only. Every plausible canonical kind
        // remains eligible; usage may influence ranking inside provider
        // matching, never remove a kind from consideration.
        const outcomes = await Promise.all([
          this.discoverArea(
            anchor,
            options.destinationCountryCode,
            options.destinationPoint,
            options.geographicScope,
          ),
          this.discoverRoute(anchor, options.geographicScope),
          this.discoverPlace(
            anchor,
            options.destinationCountryCode,
            options.geographicScope,
          ),
        ]);
        // Canonical invariant (Bitácora F1): a candidate the canonical
        // destination-compatibility policy marks INCOMPATIBLE is never an
        // anchor, even when another branch found a real same-name entity
        // inside the destination. Demoted centrally here so no single
        // branch can select an out-of-destination candidate; the rejected
        // discovery stays a bounded fact (F3) and drives the honest
        // DESTINATION_INCOMPATIBLE reason when nothing else was found.
        const evaluated: CandidateDiscovery[] = outcomes.map((outcome) =>
          outcome.status === 'match' &&
          outcome.compatibility.verdict === 'INCOMPATIBLE'
            ? {
                status: 'rejected',
                reason: 'DESTINATION_INCOMPATIBLE',
                candidate: outcome.candidate,
                compatibility: outcome.compatibility,
              }
            : outcome,
        );
        const match = this.selectCandidate(evaluated);
        // Ambiguity only ever exists among destination-compatible
        // candidates (Bitácora F1).
        const ambiguous = this.countEligibleIdentities(evaluated) > 1;
        let verificationFailed = false;
        if (match?.status === 'match') {
          const persisted = await this.persistCandidate(
            anchor,
            match.candidate,
          );
          if (persisted) {
            return {
              ...persisted,
              candidateFacts: buildAnchorCandidateFacts(
                evaluated,
                match,
                ambiguous,
                false,
              ),
            };
          }
          // Verification failed — candidate was selected but could not be
          // confirmed. This is a distinct failure from provider unavailable.
          verificationFailed = true;
        }
        const candidateFacts = buildAnchorCandidateFacts(
          evaluated,
          match,
          ambiguous,
          verificationFailed,
        );
        const unavailable = evaluated.find(
          (outcome) => outcome.status === 'unavailable',
        );
        const rejectedAny = evaluated.some(
          (outcome) => outcome.status === 'rejected',
        );
        return {
          status: 'unresolved',
          rawName: anchor.rawName,
          usage: anchor.usage,
          priority: anchor.priority,
          unresolvedReason: verificationFailed
            ? 'IDENTITY_NOT_VERIFIED'
            : unavailable?.status === 'unavailable'
              ? `GEO_PROVIDER_UNAVAILABLE:${unavailable.reason}`
              : rejectedAny
                ? 'DESTINATION_INCOMPATIBLE'
                : 'NO_CONFIDENT_GEO_ENTITY_MATCH',
          candidateFacts,
        };
      }),
    );
  }

  private async discoverPlace(
    anchor: InterpretedAnchor,
    destinationCountryCode: string | undefined,
    geographicScope: GeographicScope,
  ): Promise<CandidateDiscovery> {
    let nominatimUnavailable = false;
    if (this.nominatim) {
      try {
        const results = await this.nominatim.search(
          anchor.rawName,
          destinationCountryCode
            ? { countryCode: destinationCountryCode }
            : undefined,
        );
        const match = bestNominatimMatch(anchor.rawName, results);
        if (
          match &&
          Number.isFinite(match.latitude) &&
          Number.isFinite(match.longitude) &&
          !isAreaScaleEligible(match)
        ) {
          const canonicalName =
            match.displayName.split(',')[0]?.trim() || anchor.rawName;
          const externalId = `osm:${match.osmType}:${match.osmId}`;
          // When multiple Nominatim results share the same normalized name,
          // the exact-name match alone cannot confirm a unique identity.
          const exactNameCount = countNominatimExactMatches(
            anchor.rawName,
            results,
          );
          const candidate: AnchorGeoCandidate = {
            kind: 'venue',
            canonicalName,
            provider: 'nominatim',
            externalId,
            latitude: match.latitude,
            longitude: match.longitude,
            geometry: {
              type: 'Point',
              coordinates: [match.longitude, match.latitude],
            },
            nameEvidenceMultiplicity: {
              exactName: candidateMatchCountToMultiplicity(exactNameCount),
              declaredAlias: 'UNKNOWN',
            },
          };
          // Bitácora F1: a venue discovered outside the resolved
          // destination boundary is never an anchor candidate (homonym
          // protection). UNKNOWN (e.g. point-radius destinations) keeps
          // the venue eligible, as before.
          const compatibility = evaluateDestinationCompatibility(
            {
              probePoints: [
                { latitude: match.latitude, longitude: match.longitude },
              ],
            },
            geographicScope,
          );
          if (compatibility.verdict === 'INCOMPATIBLE') {
            return {
              status: 'rejected',
              reason: 'DESTINATION_INCOMPATIBLE',
              candidate,
              compatibility,
            };
          }
          return { status: 'match', candidate, compatibility };
        }
        // A no-match from this provider is not authoritative: the Places
        // identity capability may still know the named destination.
      } catch {
        // Continue to the independent Places identity capability.
        nominatimUnavailable = true;
      }
    }

    if (!this.placesApi)
      return nominatimUnavailable
        ? {
            status: 'unavailable',
            reason: 'NOMINATIM_UNAVAILABLE;NO_PLACES_PROVIDER',
          }
        : { status: 'no_match', reason: 'NO_PLACES_PROVIDER' };
    try {
      const result = await this.placesApi.searchText({
        textQuery: anchor.rawName,
        maxResultCount: 3,
      });
      const place = result.data[0];
      if (!place?.location || !hasCrediblePlaceType(place))
        return nominatimUnavailable
          ? {
              status: 'unavailable',
              reason: 'NOMINATIM_UNAVAILABLE;NO_CONFIDENT_PLACE_MATCH',
            }
          : { status: 'no_match', reason: 'NO_CONFIDENT_PLACE_MATCH' };
      const canonicalName =
        place.displayName?.text || place.name || anchor.rawName;
      const provider = placesAcquisitionLabel(this.placesApi.provider);
      const externalId = canonicalPlacesExternalId(
        this.placesApi.provider,
        place.id,
      );
      // When multiple Places results share the same normalized name,
      // the exact-name match alone cannot confirm a unique identity.
      const exactNameCount = countExactNormalizedMatches(
        anchor.rawName,
        result.data,
        (p) => p.displayName?.text || p.name,
      );
      const candidate: AnchorGeoCandidate = {
        kind: 'venue',
        canonicalName,
        provider,
        externalId,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        geometry: {
          type: 'Point',
          coordinates: [place.location.longitude, place.location.latitude],
        },
        placeTypes: [
          ...(place.primaryType ? [place.primaryType] : []),
          ...(place.types ?? []),
        ],
        nameEvidenceMultiplicity: {
          exactName: candidateMatchCountToMultiplicity(exactNameCount),
          declaredAlias: 'UNKNOWN',
        },
      };
      // Bitácora F1: a venue discovered outside the resolved destination
      // boundary is never an anchor candidate (homonym protection).
      const compatibility = evaluateDestinationCompatibility(
        {
          probePoints: [
            {
              latitude: place.location.latitude,
              longitude: place.location.longitude,
            },
          ],
        },
        geographicScope,
      );
      if (compatibility.verdict === 'INCOMPATIBLE') {
        return {
          status: 'rejected',
          reason: 'DESTINATION_INCOMPATIBLE',
          candidate,
          compatibility,
        };
      }
      return { status: 'match', candidate, compatibility };
    } catch {
      return {
        status: 'unavailable',
        reason: nominatimUnavailable
          ? 'NOMINATIM_UNAVAILABLE;PLACES_SEARCH_FAILED'
          : 'PLACES_SEARCH_FAILED',
      };
    }
  }

  private selectCandidate(
    outcomes: CandidateDiscovery[],
  ): CandidateDiscovery | undefined {
    const matches = outcomes.filter(
      (outcome): outcome is Extract<CandidateDiscovery, { status: 'match' }> =>
        outcome.status === 'match',
    );
    if (matches.length === 0) return undefined;
    const identities = new Set(
      matches.map(({ candidate }) => candidateIdentityKey(candidate)),
    );
    if (identities.size !== 1) return undefined;
    return matches[0];
  }

  /**
   * Distinct eligible (destination-compatible) candidate identities across
   * branches. More than one means the selection is genuinely ambiguous
   * (Bitácora F1): ambiguity only exists among compatible candidates.
   */
  private countEligibleIdentities(outcomes: CandidateDiscovery[]): number {
    return new Set(
      outcomes
        .filter(
          (
            outcome,
          ): outcome is Extract<CandidateDiscovery, { status: 'match' }> =>
            outcome.status === 'match',
        )
        .map(({ candidate }) => candidateIdentityKey(candidate)),
    ).size;
  }

  /**
   * Converts an internal AnchorGeoCandidate into a transient EntityCandidate
   * suitable for the shared IdentityVerifier. The EntityCandidate carries
   * every fact needed to verify AND persist — single source of truth.
   */
  private toEntityCandidate(
    anchor: InterpretedAnchor,
    candidate: AnchorGeoCandidate,
  ): EntityCandidate {
    if (candidate.routeEntity) return candidate.routeEntity;
    const kind =
      candidate.kind === 'area'
        ? GeoEntityKind.AREA
        : candidate.kind === 'route'
          ? GeoEntityKind.ROUTE
          : GeoEntityKind.PLACE;
    return {
      hintKey: anchor.rawName,
      hintName: anchor.rawName,
      provider: candidate.provider,
      externalId: candidate.externalId,
      canonicalName: candidate.canonicalName,
      kind,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      geometry: candidate.geometry,
      role: candidate.kind,
      wikidataQid: extractWikidataQid(candidate.metadata),
      nameEvidenceMultiplicity: candidate.nameEvidenceMultiplicity,
      persistenceMetadata: candidate.metadata
        ? { tags: candidate.metadata }
        : undefined,
    };
  }

  /**
   * Runs the shared identity verification gate on an anchor candidate
   * before it may be persisted. Same IdentityVerifier, same evidence
   * construction as ExperienceProposalResolverService — single identity
   * authority.
   */
  private async verifyAnchorCandidate(
    entity: EntityCandidate,
    acquisitionEvidence: IdentityEvidence[] = [],
  ): Promise<VerificationDecision> {
    const evidence = [
      ...buildLocalIdentityEvidence({ name: entity.hintName }, entity),
      ...acquisitionEvidence,
    ];
    const attempt = {
      strategy: 'ANCHOR_RESOLUTION' as const,
      candidate: entity,
      evidence,
    };
    const directDecision = this.identityVerifier.verify(
      { name: entity.hintName },
      attempt,
    );
    if (directDecision.status === 'VERIFIED') return directDecision;
    attempt.evidence.push(
      ...(await this.identityEvidenceCollector.collect(
        { name: entity.hintName },
        entity,
      )),
    );
    return this.identityVerifier.verify({ name: entity.hintName }, attempt);
  }

  /**
   * Verifies an anchor candidate's identity before persisting. Returns
   * null when verification fails — callers must not persist unverified
   * anchor candidates.
   */
  private async persistCandidate(
    anchor: InterpretedAnchor,
    candidate: AnchorGeoCandidate,
  ): Promise<ResolvedAnchor | null> {
    const entity = this.toEntityCandidate(anchor, candidate);
    const decision = await this.verifyAnchorCandidate(
      entity,
      candidate.acquisitionEvidence,
    );
    if (decision.status !== 'VERIFIED') return null;

    const geo = entity.identities?.length
      ? await this.persistWithIdentities(entity)
      : await this.catalog.upsertGeoEntity({
          name: entity.canonicalName,
          kind: entity.kind,
          provider: entity.provider,
          externalId: entity.externalId,
          latitude: entity.latitude,
          longitude: entity.longitude,
          geometry: entity.geometry,
          metadata: entity.persistenceMetadata,
        });
    // A concurrent write attached these identities to 2+ GeoEntities: never
    // merged, the anchor stays unresolved.
    if (!geo) return null;
    return {
      status: 'resolved',
      rawName: anchor.rawName,
      usage: anchor.usage,
      priority: anchor.priority,
      canonicalName: candidate.canonicalName,
      kind: candidate.kind,
      geoEntityId: geo.id,
      provider: candidate.provider,
      externalId: candidate.externalId,
      geometry: candidate.geometry,
      osmBoundary: candidate.osmBoundary,
    };
  }

  private async persistWithIdentities(
    entity: EntityCandidate,
  ): Promise<{ id: string } | null> {
    const persisted = await this.catalog.upsertGeoEntityWithIdentities({
      name: entity.canonicalName,
      kind: entity.kind,
      identities: entity.identities!,
      latitude: entity.latitude ?? undefined,
      longitude: entity.longitude ?? undefined,
      geometry: entity.geometry as GeoJsonGeometry,
      metadata: entity.persistenceMetadata,
    });
    return persisted.status === 'IDENTITY_CONFLICT'
      ? null
      : persisted.geoEntity;
  }

  /**
   * Nominatim search(anchor.rawName) -> bestNominatimMatch(...,
   * destinationPoint) -> if way/relation -> osmPlaces.lookupBoundaryById ->
   * upsertGeoEntity(kind: AREA). A node-only match (no real polygon) or any
   * missing step returns {resolved:false} -- a normal outcome, never a
   * fabricated boundary.
   */
  private async discoverArea(
    anchor: InterpretedAnchor,
    destinationCountryCode: string | undefined,
    destinationPoint: Coordinates | undefined,
    destinationScope: GeographicScope,
  ): Promise<CandidateDiscovery> {
    if (!this.nominatim)
      return { status: 'no_match', reason: 'NO_NOMINATIM_PROVIDER' };

    try {
      const results = await this.nominatim.search(
        anchor.rawName,
        destinationCountryCode
          ? { countryCode: destinationCountryCode }
          : undefined,
      );
      const match = bestNominatimMatch(
        anchor.rawName,
        results,
        destinationPoint,
      );
      // Cutover M3.5 -- the same canonical scope-acceptance predicate
      // DestinationResolutionService uses (single source of policy truth,
      // no dual scope authority). A country/state-scale or non-urban/
      // admin match is equally nonsensical as a small area anchor.
      if (!match || !isAreaScaleEligible(match)) {
        return { status: 'no_match', reason: 'NO_CONFIDENT_AREA_MATCH' };
      }

      // When multiple Nominatim results share the same normalized name,
      // the exact-name match alone cannot confirm a unique identity.
      const exactNameCount = countNominatimExactMatches(
        anchor.rawName,
        results,
      );

      const boundary = await this.osmPlaces.lookupBoundaryById(
        match.osmType,
        match.osmId,
      );
      if (!boundary.value) {
        return boundary.status === 'failed'
          ? {
              status: 'unavailable',
              reason: boundary.failureReason ?? 'AREA_BOUNDARY_LOOKUP_FAILED',
            }
          : { status: 'no_match', reason: 'NO_AREA_BOUNDARY' };
      }

      // Single destination policy: an anchor AREA outside the resolved
      // destination is never an anchor; UNKNOWN never counts as inside.
      const adminLevel = Number(boundary.value.tags?.admin_level);
      const compatibility = evaluateDestinationCompatibility(
        {
          probePoints: [
            {
              latitude: match.latitude as number,
              longitude: match.longitude as number,
            },
          ],
          self: {
            osmType: boundary.value.osmType,
            osmId: boundary.value.osmId,
            ...(Number.isFinite(adminLevel) ? { adminLevel } : {}),
          },
        },
        destinationScope,
      );
      const point = representativePoint(boundary.value.geometry);
      const candidate: AnchorGeoCandidate = {
        kind: 'area',
        canonicalName: boundary.value.name,
        provider: 'openstreetmap',
        externalId: boundary.value.id,
        latitude: point?.latitude,
        longitude: point?.longitude,
        geometry: boundary.value.geometry,
        metadata: boundary.value.tags,
        osmBoundary: boundary.value,
        nameEvidenceMultiplicity: {
          exactName: candidateMatchCountToMultiplicity(exactNameCount),
          declaredAlias: 'UNKNOWN',
        },
      };
      // An INCOMPATIBLE discovery stays a bounded rejected fact (Bitácora
      // F1/F3) -- never selectable. UNKNOWN never counts as inside for an
      // AREA anchor, but it is a no-match, not a rejection.
      if (compatibility.verdict === 'INCOMPATIBLE') {
        return {
          status: 'rejected',
          reason: 'DESTINATION_INCOMPATIBLE',
          candidate,
          compatibility,
        };
      }
      if (compatibility.verdict !== 'COMPATIBLE') {
        return {
          status: 'no_match',
          reason: 'DESTINATION_COMPATIBILITY_UNKNOWN',
        };
      }
      return { status: 'match', candidate, compatibility };
    } catch {
      return { status: 'unavailable', reason: 'AREA_PROVIDER_FAILED' };
    }
  }

  async resolveArea(
    anchor: InterpretedAnchor,
    destinationCountryCode: string | undefined,
    destinationPoint: Coordinates | undefined,
    geographicScope: GeographicScope,
  ): Promise<AnchorGeometryResolution> {
    const outcome = await this.discoverArea(
      anchor,
      destinationCountryCode,
      destinationPoint,
      geographicScope,
    );
    if (outcome.status !== 'match') {
      return outcome.status === 'unavailable'
        ? { resolved: false, status: 'unavailable', reason: outcome.reason }
        : { resolved: false, status: 'no_match', reason: outcome.reason };
    }
    const persisted = await this.persistCandidate(anchor, outcome.candidate);
    if (!persisted || persisted.status !== 'resolved') {
      return {
        resolved: false,
        status: 'no_match',
        reason: 'IDENTITY_NOT_VERIFIED',
      };
    }
    return {
      resolved: true,
      status: 'match',
      kind: 'area',
      geoEntityId: persisted.geoEntityId,
      canonicalName: outcome.candidate.canonicalName,
      provider: outcome.candidate.provider,
      externalId: outcome.candidate.externalId,
      geometry: outcome.candidate.geometry,
    };
  }

  /**
   * ROUTE anchors use the SAME canonical route path as component
   * resolution: targeted OSM acquisition over the destination, strong
   * identity correlation against persisted GeoEntityIdentity rows, the
   * shared multi-identity candidate, and the typed structural fact for
   * IdentityVerifier. A non-RESOLVED outcome is a normal `no_match` (or
   * `unavailable` on provider failure), never a failure.
   */
  private async discoverRoute(
    anchor: InterpretedAnchor,
    geographicScope: GeographicScope,
  ): Promise<CandidateDiscovery> {
    const result = await this.targetedRouteResolver.resolve({
      name: anchor.rawName,
      destination: geographicScope,
    });
    if (result.status === 'UNAVAILABLE') {
      return { status: 'unavailable', reason: 'ROUTE_PROVIDER_FAILED' };
    }
    if (result.status !== 'RESOLVED' || !result.resolved) {
      return { status: 'no_match', reason: `TARGETED_ROUTE_${result.status}` };
    }
    const cluster = result.resolved;
    const knownGeoEntityIds = await this.catalog.findGeoEntityIdsByIdentities(
      'openstreetmap',
      cluster.segmentExternalIds,
    );
    if (knownGeoEntityIds.length > 1) {
      return { status: 'no_match', reason: 'IDENTITY_CONFLICT' };
    }
    const routeEntity = buildRouteClusterCandidate(
      { key: anchor.rawName, name: anchor.rawName, role: 'route' },
      cluster,
    );
    return {
      status: 'match',
      compatibility: cluster.compatibility,
      candidate: {
        kind: 'route',
        canonicalName: routeEntity.canonicalName,
        provider: routeEntity.provider,
        externalId: routeEntity.externalId,
        latitude: routeEntity.latitude ?? undefined,
        longitude: routeEntity.longitude ?? undefined,
        geometry: routeEntity.geometry as GeoJsonGeometry,
        nameEvidenceMultiplicity: routeEntity.nameEvidenceMultiplicity,
        routeEntity,
        acquisitionEvidence: [structuredRouteEvidence(cluster)],
      },
    };
  }

  async resolveRoute(
    anchor: InterpretedAnchor,
    geographicScope: GeographicScope,
  ): Promise<AnchorGeometryResolution> {
    const outcome = await this.discoverRoute(anchor, geographicScope);
    if (outcome.status !== 'match') {
      return outcome.status === 'unavailable'
        ? { resolved: false, status: 'unavailable', reason: outcome.reason }
        : { resolved: false, status: 'no_match', reason: outcome.reason };
    }
    const persisted = await this.persistCandidate(anchor, outcome.candidate);
    if (!persisted || persisted.status !== 'resolved') {
      return {
        resolved: false,
        status: 'no_match',
        reason: 'IDENTITY_NOT_VERIFIED',
      };
    }
    return {
      resolved: true,
      status: 'match',
      kind: 'route',
      geoEntityId: persisted.geoEntityId,
      canonicalName: outcome.candidate.canonicalName,
      provider: outcome.candidate.provider,
      externalId: outcome.candidate.externalId,
      geometry: outcome.candidate.geometry,
    };
  }
}
