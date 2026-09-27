import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DestinationCompatibility,
  DestinationCompatibilityCandidate,
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
import {
  INominatimApiService,
  NominatimResult,
} from '@integrations/osm/interfaces/nominatim.interface';
import {
  IPlacesApiService,
  PlaceData,
} from '@integrations/google-places/interfaces/places-api.interface';
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
  allFuzzyNominatimMatches,
  candidateMatchCountToMultiplicity,
  extractWikidataQid,
  isAreaScaleEligible,
  nominatimExactMatches,
  normalizeGeoName,
  rankNominatimCandidates,
  countExactNormalizedMatches,
} from '../utils/nominatim-match.util';
import {
  placesAcquisitionLabel,
  canonicalPlacesExternalId,
} from '../utils/places-external-identity.util';
import { selectBestPlaceCandidate } from '../utils/places-candidate-selector.util';
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

/**
 * A real provider candidate that took part in one branch's selection but
 * was excluded by the canonical destination-compatibility policy before
 * ranking (same-branch homonym). Bounded audit evidence only: it never
 * re-enters selection, identity multiplicity or any downstream decision.
 */
interface RejectedBranchCandidate {
  canonicalName: string;
  kind: 'area' | 'route' | 'venue';
  provider: string;
  externalId?: string;
  compatibility: DestinationCompatibility;
}

/** Bitácora bound on rejected same-branch facts per branch. */
const MAX_REJECTED_SAME_BRANCH_FACTS = 4;

function boundedRejected(rejected: RejectedBranchCandidate[]): {
  rejectedSameBranch?: RejectedBranchCandidate[];
} {
  return rejected.length > 0
    ? { rejectedSameBranch: rejected.slice(0, MAX_REJECTED_SAME_BRANCH_FACTS) }
    : {};
}

interface ScreenedCandidate<T> {
  item: T;
  compatibility: DestinationCompatibility;
}

/**
 * Applies the canonical destination-compatibility policy to EVERY plausible
 * provider candidate before any ranking, so a provider's favorite
 * out-of-destination homonym can never hide a compatible same-name
 * candidate later in the same result set. UNKNOWN stays eligible (e.g.
 * point-radius destinations), exactly as the policy defines it; ordering
 * is preserved.
 */
function screenByDestination<T>(
  items: readonly T[],
  probe: (item: T) => DestinationCompatibilityCandidate,
  scope: GeographicScope,
): {
  eligible: ScreenedCandidate<T>[];
  incompatible: ScreenedCandidate<T>[];
} {
  const screened = items.map((item) => ({
    item,
    compatibility: evaluateDestinationCompatibility(probe(item), scope),
  }));
  return {
    eligible: screened.filter(
      (e) => e.compatibility.verdict !== 'INCOMPATIBLE',
    ),
    incompatible: screened.filter(
      (e) => e.compatibility.verdict === 'INCOMPATIBLE',
    ),
  };
}

function nominatimProbe(
  result: NominatimResult,
  withSelf = false,
): DestinationCompatibilityCandidate {
  return {
    probePoints:
      Number.isFinite(result.latitude) && Number.isFinite(result.longitude)
        ? [
            {
              latitude: result.latitude as number,
              longitude: result.longitude as number,
            },
          ]
        : [],
    ...(withSelf
      ? { self: { osmType: result.osmType, osmId: result.osmId } }
      : {}),
  };
}

function nominatimCanonicalName(result: NominatimResult, fallback: string) {
  return result.displayName.split(',')[0]?.trim() || fallback;
}

/**
 * Exact-name identity multiplicity over the destination-compatible pool
 * only: same-name results the canonical policy places outside the
 * destination are unrelated places, not competing identities. Results whose
 * compatibility is UNKNOWN still count (never more confident than the
 * evidence allows); two compatible same-name results remain MULTIPLE.
 */
function compatibleNominatimExactNameCount(
  name: string,
  results: readonly NominatimResult[],
  scope: GeographicScope,
  withSelf: boolean,
): number {
  return nominatimExactMatches(name, results).filter(
    (result) =>
      evaluateDestinationCompatibility(nominatimProbe(result, withSelf), scope)
        .verdict !== 'INCOMPATIBLE',
  ).length;
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
      /**
       * Incompatible same-branch homonyms the canonical policy removed
       * from the selectable set before this candidate was ranked/selected
       * (audit evidence only; bounded).
       */
      rejectedSameBranch?: RejectedBranchCandidate[];
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
      /** Additional incompatible same-branch candidates (audit only). */
      rejectedSameBranch?: RejectedBranchCandidate[];
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
  return outcomes.flatMap((outcome, index): AnchorCandidateFact[] => {
    const branch = ANCHOR_DISCOVERY_BRANCHES[index] ?? 'place';
    // Same-branch incompatible homonyms get their own rows (several facts
    // may share one branch), so the Bitácora shows which candidates were
    // considered, which were destination-incompatible and which remained
    // eligible. Audit output only, bounded.
    const rejectedFacts: AnchorCandidateFact[] =
      outcome.status === 'match' || outcome.status === 'rejected'
        ? (outcome.rejectedSameBranch ?? []).map((rejected) => ({
            branch,
            discoveryStatus: 'rejected' as const,
            eligibility: 'REJECTED_DESTINATION_INCOMPATIBLE' as const,
            canonicalName: rejected.canonicalName,
            kind: rejected.kind,
            provider: rejected.provider,
            ...(rejected.externalId ? { externalId: rejected.externalId } : {}),
            compatibility: {
              verdict: rejected.compatibility.verdict,
              reason: rejected.compatibility.reason,
            },
            discoveryReason: 'DESTINATION_INCOMPATIBLE',
          }))
        : [];
    if (outcome.status === 'match') {
      const isSelected = outcome === selected;
      return [
        {
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
        },
        ...rejectedFacts,
      ];
    }
    if (outcome.status === 'rejected') {
      return [
        {
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
        },
        ...rejectedFacts,
      ];
    }
    return [
      {
        branch,
        discoveryStatus: outcome.status,
        eligibility:
          outcome.status === 'unavailable'
            ? ('PROVIDER_UNAVAILABLE' as const)
            : ('NO_CANDIDATE' as const),
        discoveryReason: outcome.reason,
      },
    ];
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
                ...(outcome.rejectedSameBranch
                  ? { rejectedSameBranch: outcome.rejectedSameBranch }
                  : {}),
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
        const venueOutcome = this.selectCompatibleNominatimVenue(
          anchor,
          results,
          geographicScope,
        );
        if (venueOutcome) return venueOutcome;
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
      const provider = placesAcquisitionLabel(this.placesApi.provider);
      const nameOf = (place: PlaceData) =>
        place.displayName?.text || place.name;
      const probe = (place: PlaceData): DestinationCompatibilityCandidate => ({
        probePoints: place.location
          ? [
              {
                latitude: place.location.latitude,
                longitude: place.location.longitude,
              },
            ]
          : [],
      });
      // Plausibility first, then the canonical destination compatibility
      // per candidate, then selection among compatible candidates only:
      // item zero never wins blindly when it lies outside the destination.
      const plausible = result.data.filter(
        (place) => !!place?.location && hasCrediblePlaceType(place),
      );
      if (plausible.length === 0)
        return nominatimUnavailable
          ? {
              status: 'unavailable',
              reason: 'NOMINATIM_UNAVAILABLE;NO_CONFIDENT_PLACE_MATCH',
            }
          : { status: 'no_match', reason: 'NO_CONFIDENT_PLACE_MATCH' };
      const { eligible, incompatible } = screenByDestination(
        plausible,
        probe,
        geographicScope,
      );
      const toCandidate = (
        place: PlaceData,
        exactNameCount: number,
      ): AnchorGeoCandidate =>
        this.buildPlacesVenueCandidate(
          anchor,
          place,
          provider,
          candidateMatchCountToMultiplicity(exactNameCount),
        );
      const toRejected = ({
        item,
        compatibility,
      }: ScreenedCandidate<PlaceData>): RejectedBranchCandidate => ({
        canonicalName: nameOf(item) || anchor.rawName,
        kind: 'venue',
        provider,
        externalId: canonicalPlacesExternalId(
          this.placesApi!.provider,
          item.id,
        ),
        compatibility,
      });
      if (eligible.length === 0) {
        // Every plausible candidate lies outside the destination: fail
        // honestly, never fall back to the wrong geography.
        const [primary, ...rest] = incompatible;
        return {
          status: 'rejected',
          reason: 'DESTINATION_INCOMPATIBLE',
          candidate: toCandidate(primary.item, 0),
          compatibility: primary.compatibility,
          ...boundedRejected(rest.map(toRejected)),
        };
      }
      // Use the shared canonical Places selector: exact normalized name
      // beats provider rank; multiple exact names use destination proximity
      // as tie-break. Destination filtering already happened via
      // screenByDestination.
      const selected = selectBestPlaceCandidate(
        anchor.rawName,
        eligible.map((e) => e.item),
        // Destination point for proximity tie-break among exact matches.
        // The anchor resolver receives this via resolveNamedAnchors options.
        // We don't have it directly here, but the probe items have coordinates.
        // Extract from first eligible if needed, but the selector handles undefined.
        undefined,
      );
      if (!selected) {
        // Should not happen since eligible.length > 0 and all have coordinates,
        // but guard anyway.
        const primary = eligible[0];
        return {
          status: 'match',
          candidate: toCandidate(primary.item, 0),
          compatibility: primary.compatibility,
          ...boundedRejected(incompatible.map(toRejected)),
        };
      }
      const selectedEntry = eligible.find((e) => e.item === selected)!;
      // Identity multiplicity over the destination-compatible pool only:
      // same-name places outside the destination are not part of this
      // branch's selectable identity set, while two compatible same-name
      // identities still count as MULTIPLE.
      const exactNameCount = countExactNormalizedMatches(
        anchor.rawName,
        eligible.map((e) => e.item),
        (place) => place.displayName?.text || place.name,
      );
      return {
        status: 'match',
        candidate: toCandidate(selectedEntry.item, exactNameCount),
        compatibility: selectedEntry.compatibility,
        ...boundedRejected(incompatible.map(toRejected)),
      };
    } catch {
      return {
        status: 'unavailable',
        reason: nominatimUnavailable
          ? 'NOMINATIM_UNAVAILABLE;PLACES_SEARCH_FAILED'
          : 'PLACES_SEARCH_FAILED',
      };
    }
  }

  /**
   * Nominatim venue-branch selection: exact-name (or, when no exact name
   * exists, the single fuzzy) candidates -> venue-scale plausibility ->
   * canonical destination compatibility PER candidate -> rank among
   * compatible candidates only -> multiplicity over the compatible pool
   * only. Incompatible homonyms stay bounded rejected audit facts. Returns
   * undefined when this branch has nothing to offer (the caller falls
   * through to the Places capability).
   */
  private selectCompatibleNominatimVenue(
    anchor: InterpretedAnchor,
    results: NominatimResult[],
    geographicScope: GeographicScope,
  ): CandidateDiscovery | undefined {
    const isPlausibleVenue = (result: NominatimResult): boolean =>
      Number.isFinite(result.latitude) &&
      Number.isFinite(result.longitude) &&
      !isAreaScaleEligible(result);
    const exact = nominatimExactMatches(anchor.rawName, results);
    const fuzzy =
      exact.length === 0
        ? allFuzzyNominatimMatches(anchor.rawName, results)
        : [];
    const pool = [...exact, ...fuzzy].filter(isPlausibleVenue);
    if (pool.length === 0) return undefined;

    const { eligible, incompatible } = screenByDestination(
      pool,
      (result) => nominatimProbe(result),
      geographicScope,
    );
    const toRejected = ({
      item,
      compatibility,
    }: ScreenedCandidate<NominatimResult>): RejectedBranchCandidate => ({
      canonicalName: nominatimCanonicalName(item, anchor.rawName),
      kind: 'venue',
      provider: 'nominatim',
      externalId: `osm:${item.osmType}:${item.osmId}`,
      compatibility,
    });
    if (eligible.length === 0) {
      // Every plausible same-name venue lies outside the destination: fail
      // honestly, never fall back to the wrong geography.
      const primaryResult = rankNominatimCandidates(
        incompatible.map((entry) => entry.item),
      )!;
      const primary = incompatible.find(
        (entry) => entry.item === primaryResult,
      )!;
      return {
        status: 'rejected',
        reason: 'DESTINATION_INCOMPATIBLE',
        candidate: this.buildNominatimVenueCandidate(
          anchor,
          primary.item,
          'UNKNOWN',
        ),
        compatibility: primary.compatibility,
        ...boundedRejected(
          incompatible.filter((entry) => entry !== primary).map(toRejected),
        ),
      };
    }
    // Rank among compatible candidates only: provider importance/order
    // never overrides destination compatibility.
    const selectedResult = rankNominatimCandidates(
      eligible.map((entry) => entry.item),
    )!;
    const selected = eligible.find((entry) => entry.item === selectedResult)!;
    return {
      status: 'match',
      candidate: this.buildNominatimVenueCandidate(
        anchor,
        selected.item,
        candidateMatchCountToMultiplicity(
          compatibleNominatimExactNameCount(
            anchor.rawName,
            results,
            geographicScope,
            false,
          ),
        ),
      ),
      compatibility: selected.compatibility,
      ...boundedRejected(incompatible.map(toRejected)),
    };
  }

  private buildNominatimVenueCandidate(
    anchor: InterpretedAnchor,
    match: NominatimResult,
    exactNameMultiplicity: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN',
  ): AnchorGeoCandidate {
    return {
      kind: 'venue',
      canonicalName: nominatimCanonicalName(match, anchor.rawName),
      provider: 'nominatim',
      externalId: `osm:${match.osmType}:${match.osmId}`,
      latitude: match.latitude,
      longitude: match.longitude,
      geometry: {
        type: 'Point',
        coordinates: [match.longitude as number, match.latitude as number],
      },
      nameEvidenceMultiplicity: {
        exactName: exactNameMultiplicity,
        declaredAlias: 'UNKNOWN',
      },
    };
  }

  private buildPlacesVenueCandidate(
    anchor: InterpretedAnchor,
    place: PlaceData,
    provider: string,
    exactNameMultiplicity: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN',
  ): AnchorGeoCandidate {
    return {
      kind: 'venue',
      canonicalName: place.displayName?.text || place.name || anchor.rawName,
      provider,
      externalId: canonicalPlacesExternalId(this.placesApi!.provider, place.id),
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
        exactName: exactNameMultiplicity,
        declaredAlias: 'UNKNOWN',
      },
    };
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
      // Exact-name candidates (or, when no exact name exists, ALL fuzzy
      // matches) -> the canonical area-scale predicate
      // DestinationResolutionService also uses (Cutover M3.5: a country/
      // state-scale or non-urban/admin match is nonsensical as an area
      // anchor) -> canonical destination compatibility PER candidate ->
      // rank among compatible candidates only.
      const exact = nominatimExactMatches(anchor.rawName, results);
      const fuzzy =
        exact.length === 0
          ? allFuzzyNominatimMatches(anchor.rawName, results)
          : [];
      const pool = [...exact, ...fuzzy].filter(isAreaScaleEligible);
      if (pool.length === 0) {
        return { status: 'no_match', reason: 'NO_CONFIDENT_AREA_MATCH' };
      }
      const { eligible, incompatible } = screenByDestination(
        pool,
        (result) => nominatimProbe(result, true),
        destinationScope,
      );
      const toRejected = ({
        item,
        compatibility,
      }: ScreenedCandidate<NominatimResult>): RejectedBranchCandidate => ({
        canonicalName: nominatimCanonicalName(item, anchor.rawName),
        kind: 'area',
        provider: 'nominatim',
        externalId: `osm:${item.osmType}:${item.osmId}`,
        compatibility,
      });
      if (eligible.length === 0) {
        // Every plausible area homonym lies outside the destination: fail
        // honestly, never select the wrong geography. The rejected
        // candidate is audit evidence only (never looked up or persisted).
        const primaryResult = rankNominatimCandidates(
          incompatible.map((entry) => entry.item),
          destinationPoint,
        )!;
        const primary = incompatible.find(
          (entry) => entry.item === primaryResult,
        )!;
        return {
          status: 'rejected',
          reason: 'DESTINATION_INCOMPATIBLE',
          candidate: {
            kind: 'area',
            canonicalName: nominatimCanonicalName(primary.item, anchor.rawName),
            provider: 'nominatim',
            externalId: `osm:${primary.item.osmType}:${primary.item.osmId}`,
            latitude: primary.item.latitude,
            longitude: primary.item.longitude,
            geometry: {
              type: 'Point',
              coordinates: [
                primary.item.longitude as number,
                primary.item.latitude as number,
              ],
            },
            nameEvidenceMultiplicity: {
              exactName: 'UNKNOWN',
              declaredAlias: 'UNKNOWN',
            },
          },
          compatibility: primary.compatibility,
          ...boundedRejected(
            incompatible.filter((entry) => entry !== primary).map(toRejected),
          ),
        };
      }
      const match = rankNominatimCandidates(
        eligible.map((entry) => entry.item),
        destinationPoint,
      ) as NominatimResult & { osmType: 'way' | 'relation' };
      const rejectedSameBranch = boundedRejected(incompatible.map(toRejected));
      // Multiplicity over the destination-compatible pool only.
      const exactNameCount = compatibleNominatimExactNameCount(
        anchor.rawName,
        results,
        destinationScope,
        true,
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

      // Single destination policy on the real boundary (adds the admin
      // level): an anchor AREA outside the resolved destination is never
      // an anchor; UNKNOWN never counts as inside.
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
          ...rejectedSameBranch,
        };
      }
      if (compatibility.verdict !== 'COMPATIBLE') {
        return {
          status: 'no_match',
          reason: 'DESTINATION_COMPATIBILITY_UNKNOWN',
        };
      }
      return {
        status: 'match',
        candidate,
        compatibility,
        ...rejectedSameBranch,
      };
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
