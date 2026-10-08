import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { GeoEntityKind } from '@prisma/client';
import {
  OsmCandidate,
  OsmLookupResult,
  OsmPlacesService,
} from '@integrations/osm/services/osm-places.service';
import {
  INominatimApiService,
  NOMINATIM_PROVIDER_MAXIMUM_RESULTS,
  NominatimResult,
  NominatimSearchOptions,
} from '@integrations/osm/interfaces/nominatim.interface';
import {
  IPlacesApiService,
  PlaceData,
} from '@integrations/google-places/interfaces/places-api.interface';
import {
  CatalogGeoEntityCandidate,
  ExperienceCatalogService,
} from './experience-catalog.service';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { CompositeGeographicValidationService } from './composite-geographic-validation.service';
import { ExperienceEmbeddingIndexerService } from '@shared/ai/services/experience-embedding-indexer.service';
import { Coordinates } from '@shared/utils/distance.utils';
import {
  ExperienceEntityResolutionResponse,
  ConvergenceObservation,
  EntityCandidate,
  EvidenceOrigin,
  ExperienceProposalResolver,
  ExperienceResolutionRequest,
  FinalExperienceResolutionResponse,
  ResolvedExperienceCandidate,
  ResolvedGeoEntity,
  ResolutionAttempt,
  ResolutionStrategy,
  VerificationResult,
  CandidateResolutionAudit,
  ComponentResolutionAudit,
  ResolutionAttemptAudit,
  GeographicScope,
  IdentityEvidence,
  IdentityMultiplicity,
  CompetitorPool,
  CompetitorPoolCoverage,
  CompetitorPoolMember,
  StrongIdentity,
  PlaceSearchAudit,
} from '../interfaces/experience-resolution.interface';
import { examineCompetitors } from '../utils/competitor-examination.policy';
import {
  bestNominatimMatch,
  candidateMatchCountToMultiplicity,
  aliasMatches,
  countExactNormalizedMatches,
  nominatimExactMatches,
  extractDeclaredNameAliases,
  osmEquivalenceRecord,
  extractWikidataQid,
  isAreaScaleEligible,
  isPlaceScaleEligible,
  matchesAddressHint,
  matchOsmCandidateByName,
  normalizeGeoName,
} from '../utils/nominatim-match.util';
import { selectBestPlaceCandidate } from '../utils/places-candidate-selector.util';
import { buildCompositeComponentResolution } from '../utils/component-resolution-facts.util';
import { GeoEntityHint } from '../interfaces/experience-discovery.interface';
import { calculateDistance } from '@shared/utils/distance.utils';
import { SourceObservation } from '../interfaces/experience-acquisition.interface';
import { computeQualityScore } from '../utils/quality-score.util';
import { IWikidataApiService } from '@integrations/wikidata/interfaces/wikidata.interface';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import {
  DestinationCompatibility,
  evaluateDestinationCompatibility,
  isCoarserThanDestination,
} from '../utils/destination-compatibility.policy';
import {
  admitComponentLocation,
  deriveExperienceGeographicScope,
  mayExtendBeyondDestination,
  DerivedExperienceGeographicScope,
  geographicScopeSearchWindow,
  projectExperienceGeographicScope,
  scopeSearchWindow,
} from '../utils/experience-geographic-scope.policy';
import {
  KnownExperienceGeographicScope,
  ScopeSearchWindow,
  WorkUnitAnchorScope,
} from '../interfaces/experience-geographic-scope.interface';
import {
  RouteRetrievalVariantKind,
  routeRetrievalQueryVariants,
} from '../utils/route-retrieval-name.util';
import {
  TargetedRouteResolutionResult,
  TargetedRouteResolverService,
} from './targeted-route-resolver.service';
import {
  buildRouteClusterCandidate,
  structuredRouteEvidence,
} from '../utils/route-cluster-candidate.util';
import { findReusableObservationCandidate } from '../utils/observation-hint-correlation.util';
import {
  acquisitionLabelToPlacesProvider,
  canonicalPlacesExternalId,
  placesAcquisitionLabel,
} from '../utils/places-external-identity.util';
import {
  buildLocalIdentityEvidence,
  convergenceIndependence,
} from '../utils/identity-evidence-builder.util';
import {
  candidateIdentityKey,
  contextualIdentityEvidence,
  contextuallyDistinguishedKey,
  enumeratedSnapshotLocalityCoverage,
  evaluateContextualPool,
  geographicCorrespondence,
} from '../utils/contextual-identity.policy';
import {
  structuralKindFromNominatim,
  structuralKindFromOsmTags,
  structuralKindFromPlaceFeatureClass,
} from '../utils/candidate-structural-kind.util';
import {
  COMPONENT_LOCALITY_GROUNDER,
  ComponentIdentityContext,
  ComponentLocalityGrounder,
  ContextualPoolCoverage,
  ContextualPoolMember,
} from '../interfaces/component-identity-context.interface';
import { evaluateStructuralCompatibility } from '../utils/place-structural-compatibility.policy';
import {
  EquivalenceItemFacts,
  RecordIdentityGrouping,
  groupEquivalentRecords,
  itemsNeedingFacts,
} from '../utils/record-identity-equivalence.policy';
import {
  strongIdentitiesOf,
  strongIdentityKey,
} from '../utils/strong-identity.util';
import { IdentityVerifier } from './identity-verifier.service';
import { IdentityEvidenceCollector } from './identity-evidence-collector.service';
import { traceCandidateKey } from '../utils/experience-candidate-correlation.util';
import {
  authorizesIdentityStrategy,
  buildIdentityAcquisitionPlan,
} from '../interfaces/identity-acquisition-plan.interface';
import { OverturePlacesIndexService } from '@integrations/overture/overture-places-index.service';
import {
  AuthorizedExperienceCandidate,
  GeographicValidationAuthorization,
} from '../interfaces/geographic-validation-authorization.interface';
import { DEFAULT_GEOGRAPHIC_AUTHORIZATION } from '../utils/geographic-validation-authorization.util';

/**
 * The geography phase-2 component acquisition is bounded by (spec
 * 2026-10-02 Part II §P2-7 / §P2-10): the scope that will later judge the
 * component, and the provider search window derived from its real
 * geometry. `allowsExternalLookup` is true when a verified candidate-owned
 * scope (or source evidence associating the destination) authorizes
 * Nominatim/Places lookups.
 */
interface ComponentAcquisitionScope {
  /** Absent only when the destination itself has no usable geography. */
  scope?: KnownExperienceGeographicScope;
  /** Nominatim/Places window, derived from `scope`'s real geometry. */
  window?: ScopeSearchWindow;
  /** Catalog PLACE/AREA lookup window (the candidate scope, else the entity-resolution pool scope). */
  catalogPlaceWindow?: ScopeSearchWindow;
  /** Catalog ROUTE lookup window (the destination). */
  destinationWindow?: ScopeSearchWindow;
  /** Within-area OSM pool for a candidate-owned AREA not covered by the destination pool. */
  poolBoundary?: OsmCandidate;
  /** The scope is a verified candidate-owned AREA/ROUTE (S-b/S-c). */
  candidateOwned: boolean;
  /** Bounds a phase-1 AREA hint search to the country only (ROUTE_LIKE). */
  countryBoundedAreaSearch: boolean;
  /**
   * §P2-18: the candidate may extend beyond the destination (ROUTE_LIKE, no
   * strict work-unit anchor), so a provider query bounded to the
   * destination COUNTRY (the real authority, enforced provider-side) may
   * admit a location the destination excludes. False whenever a STRICT
   * scope bounds the candidate or no country is known.
   */
  admitsCountryBoundedBeyondDestination: boolean;
}

/**
 * Picks a real candidate out of the Places top-N instead of trusting
 * provider rank as identity -- rank-0 is often a same-category business
 * that merely searches well for the query, not the specific place the hint
 * names. Among results with a usable coordinate: an exact (normalized)
 * name match wins over rank; with more than one exact match (a real
 * chain/franchise with multiple branches, all genuinely sharing that exact
 * name), the one closest to the destination wins -- never a guess, this is
 * the same distance-first tie-break `bestNominatimMatch` already uses
 * elsewhere in this module. Falls back to rank-0 only when no result's
 * name matches the hint at all, preserving prior behavior for the fuzzy
 * case (still independently verified afterward by `IdentityVerifier`).
 *
 * RE-EXPORTED from the shared canonical selector utility so the single
 * policy authority lives in one place and is reused by both
 * ExperienceProposalResolverService and AreaRouteAnchorResolverService.
 */
export { selectBestPlaceCandidate } from '../utils/places-candidate-selector.util';

/**
 * Strong identities acquired for one hint so far: every strategy that
 * reached each, in order, with the evidence origins of its record (to tell
 * real convergence from one record found twice).
 */
type SeenIdentities = Map<string, ConvergenceObservation[]>;

/**
 * Every pool examined for one hint so far, plus the canonical admission
 * predicate of that component: what COMPETITOR_EXAMINATION is computed
 * from for each later identity decision.
 */
interface HintCompetition {
  pools: CompetitorPool[];
  admits: (member: CompetitorPoolMember) => boolean;
  /**
   * Whether the component's admission scope is bounded (the destination,
   * an anchor, an owned area) or extends to the destination country
   * (§P2-18). It decides where name uniqueness is grounded.
   */
  admission: 'BOUNDED' | 'BEYOND_DESTINATION';
  /** The verified source-named composition AREA (S-b), when there is one. */
  sourceArea?: GeoJsonGeometry;
}

/**
 * The exact-name multiplicity one pool can claim. A COMPLETE pool counts
 * (SINGLE / MULTIPLE); a PARTIAL one can expose MULTIPLE but never
 * establish SINGLE -- a lone member there is UNKNOWN, not unique.
 */
function poolMultiplicity(
  count: number,
  coverage: CompetitorPoolCoverage,
): IdentityMultiplicity {
  if (coverage === 'PARTIAL' && count === 1) return 'UNKNOWN';
  return candidateMatchCountToMultiplicity(count);
}

/** A provider record as a competitor-pool member (its strong identities). */
function competitorMemberOf(candidate: EntityCandidate): CompetitorPoolMember {
  return {
    identityKeys: strongIdentitiesOf(candidate).map(strongIdentityKey),
    name: candidate.canonicalName,
    ...(Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude)
      ? {
          latitude: candidate.latitude as number,
          longitude: candidate.longitude as number,
        }
      : {}),
    structuralKind: candidate.structuralKind ?? 'UNKNOWN',
  };
}

type StrategyAcquisitionResult =
  | { status: 'not_applicable' }
  | {
      status: 'no_candidate';
      provider: string;
      query: string;
      providerResultCount?: number;
      /** Set when a structural candidate was dropped by destination scope. */
      destinationCompatibility?: DestinationCompatibility;
      /** Set when a structural candidate lay outside the candidate-owned scope. */
      outsideExperienceScope?: true;
      placeSearch?: PlaceSearchAudit;
      /** The pool the provider returned, whether or not a member was admitted. */
      competitorPool?: CompetitorPool;
    }
  | {
      status: 'candidate';
      provider: string;
      query: string;
      providerResultCount?: number;
      candidate: EntityCandidate;
      destinationCompatibility?: DestinationCompatibility;
      placeSearch?: PlaceSearchAudit;
      competitorPool?: CompetitorPool;
    }
  | {
      status: 'failed';
      provider: string;
      query: string;
      providerResultCount?: number;
      failureReason: string;
      failureStage?: 'provider_search' | 'boundary_hydration';
      candidateFoundBeforeFailure?: boolean;
    };

type ResolvedCandidateWithAudit = {
  resolved: ResolvedExperienceCandidate;
  audit: CandidateResolutionAudit;
};

/**
 * Stage 3 catalog-first lookup result. Deliberately a separate shape from
 * `StrategyAcquisitionResult`: an `ambiguous` bounded catalog match is not
 * an acquisition failure/success the way every other strategy's result is,
 * and `candidate` here always carries `geoEntityId` alongside the
 * pre-verification `EntityCandidate` -- the canonical id a catalog hit
 * reuses directly (never through `upsertGeoEntity`) once IdentityVerifier
 * accepts it, kept outside `EntityCandidate` itself so that type's own
 * "no canonical id before verification" invariant is not weakened for
 * every other strategy.
 */
type CatalogAcquisitionResult =
  | { status: 'not_applicable' }
  | { status: 'no_candidate'; provider: string; query: string }
  | {
      status: 'ambiguous';
      provider: string;
      query: string;
      poolCandidateCount: number;
    }
  | {
      status: 'candidate';
      provider: string;
      query: string;
      candidate: EntityCandidate;
      geoEntityId: string;
      /** Typed facts about HOW the catalog row was retrieved. */
      evidence: IdentityEvidence[];
    };

/**
 * Result window of the PLACES text search -- the window the Stage 3 PLACE
 * characterization measured (Geoapify Forward Geocoding G1, 11/12 PLACE
 * hints). A provider `limit` is not a plain truncation: live, for "Farmacia
 * la Estrella" around the same bias point, `limit=10` returned the real
 * pharmacy at #1 (confidence 0.9, full_match) while `limit=3` omitted it and
 * returned three unrelated pharmacies. Structural/destination filtering and
 * name multiplicity then run over this whole window.
 */
export const PLACES_TEXT_SEARCH_RESULT_WINDOW = 10;

/**
 * Upper bound on how many candidates `resolve()` resolves / persists at the
 * same time. Each accepted candidate opens its own interactive
 * `prisma.$transaction` (GeoEntity upsert + verified-Experience persist, both
 * taking `pg_advisory_xact_lock`s), and an interactive transaction holds one
 * pooled DB connection for its whole lifetime. A cold-start city (empty
 * catalog → many acquisition deficits → dozens of structured + web candidates
 * in one `resolve()` call) would otherwise fan those out unbounded and exhaust
 * the connection pool, so the surplus transactions fail with "Unable to start
 * a transaction in the given time." Keep this comfortably below the DB pool
 * size; correctness does not depend on the exact value, only throughput does.
 */
export const RESOLVER_CANDIDATE_CONCURRENCY = 4;

/**
 * Run `worker` over `items` with at most `limit` in flight at once, returning
 * results in input order regardless of completion order. Failure semantics
 * match `Promise.all(items.map(worker))`: the first rejection rejects the whole
 * call (in-flight workers are not awaited, their results are discarded).
 */
async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(limit, items.length));
  const runLane = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: lanes }, () => runLane()));
  return results;
}

/**
 * The real OSM area of a resolved AREA component (a way/relation identity
 * with its own polygon), usable for an Overpass within-area pool. Undefined
 * when the canonical AREA carries no OSM area identity — never fabricated.
 */
function osmAreaOf(
  entity: ResolvedGeoEntity | undefined,
): OsmCandidate | undefined {
  if (!entity?.geometry || !entity.externalId) return undefined;
  const match = /^osm:(way|relation):(\d+)$/.exec(entity.externalId);
  if (!match) return undefined;
  return {
    id: entity.externalId,
    name: entity.canonicalName ?? entity.hintName,
    osmType: match[1] as 'way' | 'relation',
    osmId: Number(match[2]),
    geometry: entity.geometry as GeoJsonGeometry,
    tags: {},
  };
}

/** Component reason for a non-RESOLVED targeted ROUTE acquisition. */
const TARGETED_ROUTE_UNRESOLVED_REASON: Record<
  Exclude<TargetedRouteResolutionResult['status'], 'RESOLVED'>,
  string
> = {
  AMBIGUOUS: 'AMBIGUOUS',
  NOT_FOUND: 'NO_OSM_MATCH',
  INCOMPATIBLE: 'DESTINATION_INCOMPATIBLE',
  UNAVAILABLE: 'OSM_PROVIDER_FAILED',
};

@Injectable()
export class ExperienceProposalResolverService
  implements ExperienceProposalResolver
{
  private readonly logger = new Logger(ExperienceProposalResolverService.name);
  private readonly identityVerifier: IdentityVerifier;
  private readonly identityEvidenceCollector: IdentityEvidenceCollector;
  private readonly targetedRouteResolver: TargetedRouteResolverService;

  constructor(
    private readonly osmPlaces: OsmPlacesService,
    private readonly catalog: ExperienceCatalogService,
    private readonly geographicValidator: CompositeGeographicValidationService,
    @Optional()
    private readonly embeddingIndexer?: ExperienceEmbeddingIndexerService,
    @Optional()
    @Inject('NominatimApiService')
    private readonly nominatim?: INominatimApiService,
    @Optional()
    @Inject('PlacesApiService')
    private readonly placesApi?: IPlacesApiService,
    @Optional()
    @Inject('WikidataApiService')
    private readonly wikidata?: IWikidataApiService,
    @Optional()
    private readonly overturePlaces?: OverturePlacesIndexService,
    @Optional()
    @Inject(COMPONENT_LOCALITY_GROUNDER)
    private readonly localityGrounder?: ComponentLocalityGrounder,
  ) {
    this.identityVerifier = new IdentityVerifier();
    this.identityEvidenceCollector = new IdentityEvidenceCollector(wikidata);
    this.targetedRouteResolver = new TargetedRouteResolverService(osmPlaces);
  }

  async resolve(
    input: ExperienceResolutionRequest,
  ): Promise<FinalExperienceResolutionResponse> {
    const candidates = Array.isArray(input?.candidates) ? input.candidates : [];
    const evidence = input.evidence ?? [];
    const scope = input.geographicScope;
    if (!scope)
      throw new Error('Experience resolution requires a geographic scope');
    const boundary =
      scope.kind === 'AREA_BOUNDARY' ? scope.boundary : undefined;

    // Task A6: entityResolutionScope narrows ONLY the local OSM pool
    // fetch below (and, via resolveCandidate's `poolBoundary` param, the
    // AREA-hint pool selection + trusted-global-hint fallback point) --
    // `scope`/`boundary` above are UNCHANGED and keep flowing into
    // geographic validation as the destination-wide boundary, further
    // down in this method.
    const poolScope = input.entityResolutionScope ?? scope;
    const poolBoundary =
      poolScope.kind === 'AREA_BOUNDARY' ? poolScope.boundary : undefined;

    // Stage 3 (component-resolution-and-partial-composite-recovery-plan.md):
    // a point-scale destination has no OSM area/relation, and AREA_BOUNDARY
    // alone authorizes within-area queries -- but neither fetch runs at all
    // unless some hint's resolution path actually reaches it below. These
    // memoized, request-scoped getters replace the old eager
    // `Promise.all` fetch: each real lookup executes at most once per
    // `resolve()` call, shared by every candidate concurrently resolved via
    // `mapWithBoundedConcurrency` below (a plain synchronous check-then-set
    // on first call, so two concurrent hints racing for the same pool still
    // only trigger one real Overpass call). When every hint in this call
    // resolves via CATALOG_REUSE, these are never invoked at all.
    let poiLookupPromise: Promise<OsmLookupResult<OsmCandidate[]>> | undefined;
    // A candidate-owned AREA beyond the destination pool (§P2-7 phase 2)
    // gets its own memoized within-area pool, keyed by the OSM area.
    const scopedPoiLookups = new Map<
      string,
      Promise<OsmLookupResult<OsmCandidate[]>>
    >();
    const getPoiLookup = (
      scopeBoundary?: OsmCandidate,
    ): Promise<OsmLookupResult<OsmCandidate[]>> => {
      if (scopeBoundary) {
        let scoped = scopedPoiLookups.get(scopeBoundary.id);
        if (!scoped) {
          scoped = this.osmPlaces.lookupPoisWithin(scopeBoundary);
          scopedPoiLookups.set(scopeBoundary.id, scoped);
        }
        return scoped;
      }
      if (!poiLookupPromise) {
        poiLookupPromise =
          poolScope.kind === 'POINT_RADIUS'
            ? this.osmPlaces.lookupPoisNear(
                poolScope.latitude,
                poolScope.longitude,
                poolScope.radiusMeters,
              )
            : this.osmPlaces.lookupPoisWithin(poolScope.boundary);
      }
      return poiLookupPromise;
    };

    // Candidates remain transient through acquisition and identity verification.
    const resolutionResults = await mapWithBoundedConcurrency(
      candidates,
      RESOLVER_CANDIDATE_CONCURRENCY,
      (authorized: AuthorizedExperienceCandidate) =>
        this.resolveCandidate(
          authorized.candidate,
          poolBoundary,
          getPoiLookup,
          poolScope,
          scope,
          input.destinationName,
          evidence,
          input.destinationCountryCode,
          input.observations ?? [],
          authorized.geographicAuthorization,
          input.validationScope,
        ),
    );

    // Stage 4: every candidate -- admitted or not -- carries the typed
    // identity/geography facts of EVERY source component plus its coverage.
    // Pure and transient: computed from what resolution already did (no
    // provider call), consumed by trace/audit only, never persisted as a
    // partial Experience and never an admission threshold.
    const resolvedCandidates = resolutionResults.map((result) => {
      const componentResolution = buildCompositeComponentResolution({
        candidate: result.resolved.candidate,
        entities: result.resolved.resolvedEntities,
        componentAudits: result.audit.componentAudits,
        validationScope: input.validationScope,
        geographicScope: scope,
      });
      result.audit.componentResolution = componentResolution;
      return {
        ...result.resolved,
        componentResolution,
        geographicAuthorization: result.audit.geographicAuthorization,
      };
    });
    const forensicAudit = resolutionResults.map((result) => result.audit);
    const acceptedForValidation = resolvedCandidates.filter(
      (item) => item.status === 'accepted',
    ) as ResolvedExperienceCandidate[];
    // Keyed by the candidate OBJECT itself, not `candidate.candidate.name`
    // (proposalName) -- display names are not guaranteed unique (two
    // structured/web candidates can legitimately share a name with
    // different components/geography), and a name-keyed Map would let one
    // candidate's validation result silently leak onto another, either
    // rejecting a valid candidate or persisting an invalid one under a
    // sibling's accepted result. Built inline with the map so a candidate
    // is always paired with the exact result computed for IT, regardless
    // of what any later filtering does to the result array.
    const validationByCandidate = new Map<
      ResolvedExperienceCandidate,
      ReturnType<CompositeGeographicValidationService['validate']>
    >();
    const validationResults = acceptedForValidation
      .map((item) => {
        const result = this.geographicValidator.validate(
          item,
          boundary,
          input.validationScope,
          item.geographicAuthorization ?? DEFAULT_GEOGRAPHIC_AUTHORIZATION,
          scope,
        );
        validationByCandidate.set(item, result);
        return result;
      })
      .filter(
        (
          result,
        ): result is NonNullable<
          ReturnType<CompositeGeographicValidationService['validate']>
        > => result != null,
      );

    // Component-quality wiring: batch-fetch real Wikidata sitelink counts
    // ONCE for every distinct verified component QID across every candidate
    // that will actually be persisted in this call -- never one HTTP
    // round-trip per component. Computed here (before the per-candidate
    // loop below) using the exact same geographic-acceptance predicate that
    // loop re-checks per candidate, so it only ever fetches for candidates
    // that will genuinely reach persistence.
    const componentNotabilityByQid = await this.fetchComponentNotabilityByQid(
      acceptedForValidation.filter(
        (candidate) => validationByCandidate.get(candidate)?.accepted,
      ),
    );
    // Bounded: each accepted candidate persists inside its own interactive
    // `prisma.$transaction`, holding a pooled DB connection for its lifetime —
    // an unbounded fan-out here exhausted the pool on cold-start cities.
    const resolved = await mapWithBoundedConcurrency(
      resolvedCandidates,
      RESOLVER_CANDIDATE_CONCURRENCY,
      async (candidate) => {
        if (candidate.status !== 'accepted') return candidate;

        const geographicResult = validationByCandidate.get(candidate);
        if (!geographicResult?.accepted) {
          return {
            ...candidate,
            status: 'rejected' as const,
            rejectionReasons: geographicResult?.rejectionReasons ?? [
              'GEOGRAPHIC_VALIDATION_FAILED',
            ],
          };
        }

        const traitDefinitionIds =
          await this.catalog.resolveOrCreateTraitDefinitions(
            candidate.candidate.traits,
          );
        // B3 live wiring (cutover M2): the one deterministic, provider-
        // neutral quality signal available at persistence time --
        // `qualityEvidence` is only ever populated (at the adapter
        // boundary) from real grounded signals, never invented, never
        // LLM-authored. This is a plain 1:1 field-name adaptation from the
        // normalized `QualityEvidence` contract onto `computeQualityScore`'s
        // pre-existing `QualityScoreInput` shape (Task B3/B3-amendment,
        // deliberately left unrenamed here -- see
        // docs/architecture/engineering-principles.md) -- never a provider
        // check. `computeQualityScore` returns `null` when no usable signal
        // exists; `persistVerifiedExperience` treats `undefined` the same
        // as omitting the field.
        const qualityEvidence = candidate.candidate.qualityEvidence;
        // Computed ONCE and reused for both component-quality derivation
        // and the `components` mapping below, so the two representations
        // of "this candidate's real deduped component set" can never
        // diverge (spec cutover requirement).
        const dedupedComponents = this.dedupeResolvedEntitiesByGeoEntity(
          candidate.resolvedEntities.filter(
            (entity: any) => entity.status === 'resolved' && entity.geoEntityId,
          ),
        );
        // A Wikidata QID is IDENTITY evidence (already established by
        // IdentityVerifier), never quality evidence by itself. The
        // grounded QUALITY signal is the real sitelink count fetched above
        // for that same verified QID -- only ever populated for a genuine
        // multi-component Experience (>= 2 distinct resolved components);
        // a single venue must not acquire component-derived quality merely
        // because it happens to carry a QID.
        const componentNotabilitySignals =
          dedupedComponents.length >= 2
            ? dedupedComponents
                .map((entity: any) =>
                  entity.wikidataQid
                    ? componentNotabilityByQid.get(entity.wikidataQid)
                    : undefined,
                )
                .filter(
                  (count: unknown): count is number =>
                    typeof count === 'number',
                )
            : undefined;
        const qualityScore =
          computeQualityScore({
            placesRating: qualityEvidence?.consumerRating?.value,
            placesReviewCount: qualityEvidence?.consumerRating?.reviewCount,
            wikivoyageListed: qualityEvidence?.editorialListing?.listed,
            wikidataSitelinkCount: qualityEvidence?.notability?.count,
            ...(componentNotabilitySignals
              ? { componentNotabilitySignals }
              : {}),
          }) ?? undefined;
        const experience = await this.catalog.persistVerifiedExperience({
          canonicalName: candidate.candidate.name,
          description: candidate.candidate.description,
          durationMinutes: candidate.candidate.suggestedDurationMinutes,
          qualityScore,
          metadata: {
            themes: candidate.candidate.themes,
            traits: candidate.candidate.traits,
            intents: candidate.candidate.intents ?? [],
            source: 'grounded_experience_discovery',
          },
          traitDefinitionIds,
          components: dedupedComponents.map((entity: any, index: number) => ({
            geoEntityId: entity.geoEntityId,
            // Only a real, evidence-backed visiting sequence earns a
            // concrete order — otherwise this is resolution/array order,
            // not intrinsic sequence, and must persist as null.
            order: candidate.candidate.orderedByEvidence ? index + 1 : null,
            role: entity.role,
          })),
          evidence: evidence
            .filter((item: { key?: string }) =>
              candidate.candidate.evidenceKeys?.includes(item.key ?? ''),
            )
            .map(
              (item: {
                source: string;
                url?: string;
                title?: string;
                snippet?: string;
              }) => ({
                source: item.source,
                url: item.url,
                title: item.title,
                snippet: item.snippet,
              }),
            ),
        });

        if ((experience as any).dedupeDecision === 'AMBIGUOUS') {
          return {
            ...candidate,
            status: 'rejected' as const,
            rejectionReasons: ['AMBIGUOUS_DEDUPE'],
            dedupeEvidence: (experience as any).dedupeEvidence,
            dedupeCandidates: (experience as any).dedupeCandidates,
          };
        }

        if (
          this.embeddingIndexer &&
          ((experience as any).dedupeDecision === 'NEW' ||
            (experience as any).semanticDocumentChanged)
        ) {
          const embeddingResult = await this.embeddingIndexer.index([
            experience.id,
          ]);
          if (embeddingResult.status === 'unavailable') {
            this.logger.warn(
              `Experience embedding deferred for ${experience.id}: ${embeddingResult.reason ?? 'provider unavailable'}`,
            );
          }
        }

        return {
          ...candidate,
          experienceId: experience.id,
          dedupeDecision: (experience as any).dedupeDecision,
          dedupeEvidence: (experience as any).dedupeEvidence,
        };
      },
    );

    this.logger.log(
      `Resolved ${resolved.filter((item) => item.status === 'accepted').length}/${resolved.length} Experience candidate(s) against trusted geography`,
    );

    const entityResolution: ExperienceEntityResolutionResponse = {
      totalCandidates: resolvedCandidates.length,
      acceptedCount: acceptedForValidation.length,
      rejectedCount: resolvedCandidates.length - acceptedForValidation.length,
      resolved: resolvedCandidates,
      forensicAudit,
    };
    const geographicValidation = {
      results: validationResults,
      acceptedCount: validationResults.filter((item) => item.accepted).length,
      rejectedCount: validationResults.filter((item) => !item.accepted).length,
      resolved: acceptedForValidation,
    };

    return {
      totalCandidates: resolved.length,
      acceptedCount: resolved.filter((item) => item.status === 'accepted')
        .length,
      rejectedCount: resolved.filter((item) => item.status === 'rejected')
        .length,
      resolved,
      entityResolution,
      geographicValidation,
      materialization: { resolved },
      validationScope: input.validationScope,
      destinationBoundary: boundary
        ? {
            name: boundary.name,
            externalId: boundary.id,
          }
        : undefined,
    };
  }

  private async resolveCandidate(
    candidate: any,
    boundary: OsmCandidate | undefined,
    getPoiLookup: (
      scopeBoundary?: OsmCandidate,
    ) => Promise<OsmLookupResult<OsmCandidate[]>>,
    entityResolutionScope: GeographicScope,
    /** The DESTINATION scope: ROUTE acquisition + destination compatibility. */
    destinationScope: GeographicScope,
    destinationName?: string,
    evidence: ExperienceResolutionRequest['evidence'] = [],
    destinationCountryCode?: string,
    observations: SourceObservation[] = [],
    // Fail-closed: absent authorization is the default destination policy.
    geographicAuthorization: GeographicValidationAuthorization = DEFAULT_GEOGRAPHIC_AUTHORIZATION,
    /** S-a: the producing work unit's user-named anchor, when any. */
    workUnitScope?: WorkUnitAnchorScope,
  ): Promise<ResolvedCandidateWithAudit> {
    const entities: ResolvedGeoEntity[] = [];
    const componentAudits: CandidateResolutionAudit['componentAudits'] = [];
    const destinationAssociationVerified =
      this.hasDestinationAssociationEvidence(
        candidate,
        destinationName,
        evidence,
      );

    // Verified hint memory writes, flushed once every component of this
    // candidate is decided (see `rememberVerifiedHints`).
    const verifiedHintsToRemember: Array<{
      audit: ComponentResolutionAudit;
      geoEntityId: string;
      hintName: string;
    }> = [];

    const resolveHint = async (
      hint: any,
      componentScope: ComponentAcquisitionScope,
    ): Promise<void> => {
      const attempts: ResolutionAttemptAudit[] = [];
      // Source-grounded component context (stated locality and kind),
      // resolved once per hint before any acquisition and passed explicitly
      // to candidate selection and to every identity decision.
      const identityContext = await this.groundIdentityContext(
        hint,
        destinationCountryCode,
      );
      // Real-world identity by ID equality, tracked across every strategy
      // attempted for THIS hint (verified or not): keyed by every strong
      // identity (namespace + canonical id, see strongIdentityKey) an
      // acquisition carried, valued by the first strategy that found it.
      // When a LATER, structurally independent strategy acquires a
      // candidate whose identity set intersects these keys, `isVerified`
      // below injects IDENTITY_CONVERGENCE evidence -- never a name/string
      // comparison, never a vote among candidates.
      const seenIdentities: SeenIdentities = new Map();
      // Every pool any strategy examines for THIS hint, kept so that each
      // later identity decision sees the competitors an earlier pool
      // exposed (whichever member that strategy selected).
      const competition: HintCompetition = {
        pools: [],
        admission:
          this.destinationPoolCoverage(componentScope) === 'COMPLETE'
            ? 'BOUNDED'
            : 'BEYOND_DESTINATION',
        ...(componentScope.scope?.kind === 'AREA' &&
        componentScope.scope.provenance === 'CANDIDATE_AREA'
          ? { sourceArea: componentScope.scope.geometry }
          : {}),
        admits: (member) =>
          this.admitsCompetitor(
            member,
            componentScope,
            destinationScope,
            destinationCountryCode,
          ),
      };
      const recordAttempt = (
        strategy: ResolutionStrategy,
        acquisition: {
          status: 'completed' | 'failed' | 'no_candidate';
          provider?: string;
          query?: string;
          providerResultCount?: number;
          poolCandidateCount?: number;
          entity?: EntityCandidate;
          failureReason?: string;
          failureStage?: 'provider_search' | 'boundary_hydration';
          candidateFoundBeforeFailure?: boolean;
          destinationCompatibility?: DestinationCompatibility;
          routeResolution?: ResolutionAttemptAudit['routeResolution'];
          placeSearch?: PlaceSearchAudit;
          recordEquivalence?: ResolutionAttemptAudit['recordEquivalence'];
        },
        verification: VerificationResult | undefined,
      ): void => {
        attempts.push({
          ...(acquisition.recordEquivalence
            ? { recordEquivalence: acquisition.recordEquivalence }
            : {}),
          ...(acquisition.destinationCompatibility
            ? { destinationCompatibility: acquisition.destinationCompatibility }
            : {}),
          ...(acquisition.routeResolution
            ? { routeResolution: acquisition.routeResolution }
            : {}),
          ...(acquisition.placeSearch
            ? { placeSearch: acquisition.placeSearch }
            : {}),
          strategy,
          executionStatus:
            acquisition.status === 'failed' ? 'failed' : 'completed',
          provider: acquisition.provider,
          query: acquisition.query ?? hint.name,
          providerResultCount: acquisition.providerResultCount,
          poolCandidateCount: acquisition.poolCandidateCount,
          candidateAcquired:
            acquisition.status !== 'failed' && Boolean(acquisition.entity),
          failureReason: acquisition.failureReason,
          failureStage: acquisition.failureStage,
          candidateFoundBeforeFailure: acquisition.candidateFoundBeforeFailure,
          selectedCandidate:
            acquisition.status !== 'failed' && acquisition.entity
              ? {
                  canonicalName: acquisition.entity.canonicalName,
                  externalId: acquisition.entity.externalId,
                  kind: acquisition.entity.kind,
                  identities: strongIdentitiesOf(acquisition.entity),
                  ...(Number.isFinite(acquisition.entity.latitude) &&
                  Number.isFinite(acquisition.entity.longitude)
                    ? {
                        latitude: acquisition.entity.latitude as number,
                        longitude: acquisition.entity.longitude as number,
                      }
                    : {}),
                }
              : undefined,
          identityEvidence: verification?.evidence ?? [],
          verificationDecision: verification?.decision.status,
          ...(verification
            ? {
                verificationRule: verification.decision.rule,
                decisiveEvidence: verification.decision.decisiveEvidence,
              }
            : {}),
        });
      };
      const finishAudit = (entity: ResolvedGeoEntity): void => {
        const audit: ComponentResolutionAudit = {
          hintKey: hint.key,
          hintName: hint.name,
          ...(hint.sourceName ? { sourceName: hint.sourceName } : {}),
          ...(hint.normalizationKind
            ? { normalizationKind: hint.normalizationKind }
            : {}),
          role: hint.role,
          expectedKind: hint.expectedKind,
          evidenceKeys: [...hint.evidenceKeys],
          addressHint: hint.addressHint,
          ...(identityContext.locality ||
          identityContext.physicalKind ||
          hint.sourceLink
            ? {
                identityContext: {
                  ...(identityContext.locality
                    ? {
                        locality: {
                          ...identityContext.locality.assertion,
                          grounding: identityContext.locality.status,
                          ...(identityContext.locality.status === 'GROUNDED'
                            ? {
                                boundaryId:
                                  identityContext.locality.boundary.externalId,
                                boundaryName:
                                  identityContext.locality.boundary.name,
                              }
                            : {
                                ungroundedReason:
                                  identityContext.locality.reason,
                              }),
                        },
                      }
                    : {}),
                  ...(identityContext.physicalKind
                    ? { physicalKind: identityContext.physicalKind }
                    : {}),
                  ...(hint.sourceLink ? { sourceLink: hint.sourceLink } : {}),
                },
              }
            : {}),
          attempts,
          finalStatus: entity.status,
          finalReason: entity.reason,
          resolvedGeoEntity:
            entity.status === 'resolved'
              ? {
                  geoEntityId: entity.geoEntityId,
                  canonicalName: entity.canonicalName,
                  provider: entity.provider,
                  externalId: entity.externalId,
                  ...(entity.persistence
                    ? { persistence: entity.persistence }
                    : {}),
                }
              : undefined,
        };
        componentAudits.push(audit);
        // Verified hint memory: only a resolution that IdentityVerifier
        // accepted through external acquisition (CATALOG_REUSE already
        // knows the hint), onto a GeoEntity of the hint's own expected kind
        // (the catalog lookup is kind-scoped; an AREA hint corrected to a
        // PLACE is never remembered as that PLACE's hint). REJECTED,
        // AMBIGUOUS, UNCONFIRMED, NO_CANDIDATE, IDENTITY_CONFLICT and
        // provider failures never reach `status: 'resolved'`.
        const verified = attempts.find(
          (attempt) => attempt.verificationDecision === 'VERIFIED',
        );
        if (
          entity.status === 'resolved' &&
          entity.geoEntityId &&
          verified &&
          verified.strategy !== 'CATALOG_REUSE' &&
          verified.selectedCandidate?.kind === hint.expectedKind
        ) {
          verifiedHintsToRemember.push({
            audit,
            geoEntityId: entity.geoEntityId,
            hintName: hint.name,
          });
        }
      };
      let unconfirmedCatalogMatch: ResolvedGeoEntity | undefined;
      // Stage 3 (component-resolution-and-partial-composite-recovery-plan.md,
      // "Catalog-first identity resolution"): tried FIRST, ahead of
      // TRUSTED_OBSERVATION_REUSE below -- persisted canonical GeoEntity
      // knowledge is strictly cheaper than a same-run structured
      // observation, which can still require its own external provider
      // detail fetch (`resolveViaTrustedObservation`'s `getPlaceDetails`
      // call) to be confirmed. A sufficiently unambiguous match against
      // already-canonical GeoEntity knowledge is terminal success for this
      // component -- no OSM/Nominatim/Places/Wikidata call is made to
      // re-prove an identity the catalog already established. Ownership
      // stays split exactly as the checkpoint requires: the catalog service
      // (`findGeoEntityCandidatesForHint`) returns bounded candidates/facts
      // only, `resolveViaCatalog` below never picks a winner out of an
      // ambiguous set, and `IdentityVerifier` (via the same `isVerified`
      // every other strategy already uses) remains the sole authority that
      // declares VERIFIED.
      const catalogResult = await this.resolveViaCatalog(
        hint,
        componentScope.catalogPlaceWindow,
        componentScope.destinationWindow,
        destinationScope,
      );
      if (catalogResult.status === 'candidate') {
        const verification = await this.isVerified(
          'CATALOG_REUSE',
          catalogResult.candidate,
          hint,
          observations,
          seenIdentities,
          catalogResult.evidence,
          identityContext,
          competition,
        );
        recordAttempt(
          'CATALOG_REUSE',
          {
            status: 'completed',
            provider: catalogResult.provider,
            query: catalogResult.query,
            entity: catalogResult.candidate,
          },
          verification,
        );
        if (verification.decision.status === 'VERIFIED') {
          // Reuses the existing canonical GeoEntity id directly -- never
          // `upsertGeoEntity` again, which would be a pointless duplicate
          // write for an identity the catalog already persisted.
          const resolved = this.reuseCatalogGeoEntity(
            catalogResult.candidate,
            catalogResult.geoEntityId,
          );
          entities.push(resolved);
          finishAudit(resolved);
          return;
        }
        unconfirmedCatalogMatch = this.unconfirmedEntity(
          hint,
          catalogResult.provider,
        );
      } else if (catalogResult.status === 'ambiguous') {
        // 2+ bounded, same-kind, strictly name-matching GeoEntity rows.
        // Never an arbitrary winner, nearest-wins, or provider vote here --
        // fail closed into TRUSTED_OBSERVATION_REUSE/the external
        // resolution pipeline below, exactly like a catalog miss.
        recordAttempt(
          'CATALOG_REUSE',
          {
            status: 'completed',
            provider: catalogResult.provider,
            query: catalogResult.query,
            poolCandidateCount: catalogResult.poolCandidateCount,
          },
          undefined,
        );
      } else if (catalogResult.status === 'no_candidate') {
        recordAttempt(
          'CATALOG_REUSE',
          { ...catalogResult, status: 'no_candidate' },
          undefined,
        );
      }

      // P2-B, Phase 1: an optional, non-terminal SECOND attempt, only
      // reached when catalog reuse above was not terminal (miss, ambiguous,
      // or a unique match that failed verification) -- if this run's
      // structured acquisition already gathered an unambiguous, in-scope,
      // still-live identity for this exact hint, reuse it instead of
      // re-discovering it from scratch. Never a special verification path:
      // `IdentityVerifier` here is the SAME authority every other candidate
      // goes through below. A `false`/`undefined` result is never terminal
      // -- falls straight into the unchanged pipeline.
      const reuseCandidate = await this.resolveViaTrustedObservation(
        hint,
        observations,
        boundary,
      );
      if (reuseCandidate.status === 'candidate') {
        const verification = await this.isVerified(
          'TRUSTED_OBSERVATION_REUSE',
          reuseCandidate.candidate,
          hint,
          observations,
          seenIdentities,
          [],
          identityContext,
          competition,
        );
        recordAttempt(
          'TRUSTED_OBSERVATION_REUSE',
          {
            status: 'completed',
            provider: reuseCandidate.provider,
            query: reuseCandidate.query,
            entity: reuseCandidate.candidate,
          },
          verification,
        );
        if (verification.decision.status === 'VERIFIED') {
          const resolved = await this.persistVerifiedCandidate(
            reuseCandidate.candidate,
          );
          entities.push(resolved);
          finishAudit(resolved);
          return;
        }
      } else if (reuseCandidate.status === 'no_candidate') {
        recordAttempt(
          'TRUSTED_OBSERVATION_REUSE',
          { ...reuseCandidate, status: 'no_candidate' },
          undefined,
        );
      } else if (reuseCandidate.status === 'failed') {
        recordAttempt('TRUSTED_OBSERVATION_REUSE', reuseCandidate, undefined);
      }

      const isAreaHint = hint.expectedKind === 'AREA' || hint.role === 'area';
      const isRouteHint =
        hint.expectedKind === 'ROUTE' || hint.role === 'route';

      // ROUTE (Stage 3 cutover): after a catalog miss/ambiguity, the only
      // acquisition path is targeted OSM route resolution over the
      // DESTINATION -- the map_to_area street pool and its name-matching
      // workaround are gone, and Nominatim/Places never apply to ROUTE.
      if (isRouteHint) {
        const routed = await this.resolveViaTargetedRoute(
          hint,
          destinationScope,
          observations,
          seenIdentities,
        );
        recordAttempt(
          'TARGETED_ROUTE',
          routed.acquisition,
          routed.verification,
        );
        entities.push(routed.entity);
        finishAudit(routed.entity);
        return;
      }

      // AREA destination-scope outcome that blocked a structural candidate,
      // kept as the final diagnostic if nothing else resolves the hint.
      let areaDestinationBlock: DestinationCompatibility | undefined;
      // The POI pool is lazily fetched (memoized per `resolve()` call, see
      // getPoiLookup above) -- an AREA hint only reaches it through the
      // AREA_TO_PLACE_CORRECTION fallback. A hint fully resolved above via
      // TRUSTED_OBSERVATION_REUSE/CATALOG_REUSE never reaches this line at
      // all (both `continue` before it).
      let pool: OsmCandidate[];
      let localLookup: OsmLookupResult<OsmCandidate[]> | undefined;
      if (isAreaHint) {
        pool = boundary ? [boundary] : [];
        localLookup = undefined;
      } else {
        localLookup = await getPoiLookup(componentScope.poolBoundary);
        pool = localLookup.value;
      }
      const localOsmFacts = localLookup
        ? this.localOsmAuditFacts(localLookup)
        : {
            status: 'completed' as const,
            provider: 'openstreetmap',
            poolCandidateCount: pool.length,
          };
      let matched = matchOsmCandidateByName(hint.name, pool, hint.addressHint);
      if (matched && isAreaHint) {
        // The local AREA pool is the entity-resolution anchor or the
        // destination itself; it still answers to the single destination
        // policy before it can become a component.
        const compatibility = this.areaDestinationCompatibility(
          matched,
          destinationScope,
        );
        if (compatibility.verdict !== 'COMPATIBLE') {
          recordAttempt(
            'LOCAL_OSM_POOL',
            { ...localOsmFacts, destinationCompatibility: compatibility },
            undefined,
          );
          areaDestinationBlock = compatibility;
          matched = undefined;
        }
      }

      let unconfirmedLocalMatch: ResolvedGeoEntity | undefined;
      let unconfirmedGlobalMatch: ResolvedGeoEntity | undefined;
      // Record equivalence (one physical identity mapped as several records
      // of this pool) applies to the LOCAL_OSM_POOL strategy only: its
      // records carry the tags the authority needs.
      const recordGrouping =
        localLookup?.status === 'success'
          ? await this.recordGroupingOf(pool)
          : RecordIdentityGrouping.none();
      if (localLookup?.status === 'success') {
        competition.pools.push(
          this.localCompetitorPool(
            'LOCAL_OSM_POOL',
            hint.name,
            pool,
            componentScope,
            recordGrouping,
          ),
        );
      }
      if (matched) {
        let nameMultiplicity: {
          exactName: IdentityMultiplicity;
          declaredAlias: IdentityMultiplicity;
        };
        if (isAreaHint) {
          // Single boundary candidate - no alias pool for boundary candidates
          nameMultiplicity = { exactName: 'SINGLE', declaredAlias: 'UNKNOWN' };
        } else {
          // POI pool - legitimate identity candidates
          nameMultiplicity = this.localPoolNameMultiplicity(
            hint.name,
            pool,
            componentScope,
            recordGrouping,
          );
        }
        const resolvedEntity = this.buildOsmCandidate(
          hint,
          matched,
          nameMultiplicity,
          recordGrouping,
        );
        if (!isAreaHint) {
          // Exact-name and declared-alias members are the competitors. The
          // pool is bounded to the destination (or scope) area, not to the
          // source's locality, so it is never a complete comparison: it can
          // expose an equally consistent competitor, never single one out.
          const needle = normalizeGeoName(hint.name);
          // One member per physical identity (record equivalence).
          const members = [
            ...new Map(
              [
                ...pool.filter(
                  (candidate) => normalizeGeoName(candidate.name) === needle,
                ),
                ...aliasMatches(hint.name, pool),
              ].map((candidate) => [
                recordGrouping.identityKeyOf(candidate.id),
                candidate,
              ]),
            ).values(),
          ];
          const contextualPool = evaluateContextualPool(
            identityContext,
            members.map((candidate): ContextualPoolMember => {
              const point = this.representativePoint(candidate);
              return {
                identityKey: candidateIdentityKey({
                  provider: 'openstreetmap',
                  externalId: candidate.id,
                }),
                latitude: point?.latitude,
                longitude: point?.longitude,
                structuralKind: structuralKindFromOsmTags(candidate.tags),
              };
            }),
            'NOT_ESTABLISHED',
          );
          if (contextualPool) resolvedEntity.contextualPool = contextualPool;
        }
        const verification = await this.isVerified(
          'LOCAL_OSM_POOL',
          resolvedEntity,
          hint,
          observations,
          seenIdentities,
          [],
          identityContext,
          competition,
        );
        const recordEquivalence = recordGrouping.auditOf(matched.id);
        recordAttempt(
          'LOCAL_OSM_POOL',
          {
            ...localOsmFacts,
            provider: resolvedEntity.provider,
            entity: resolvedEntity,
            ...(recordEquivalence ? { recordEquivalence } : {}),
          },
          verification,
        );
        if (verification.decision.status === 'VERIFIED') {
          const resolved = await this.persistVerifiedCandidate(resolvedEntity);
          entities.push(resolved);
          finishAudit(resolved);
          return;
        }
        // Real, live-verified regression: a local match that fails
        // confirmation must not be the final word on its own. A genuinely
        // different real entity -- one that can structurally never appear
        // in the local pool at all (e.g. "Puerto Madero", an administrative
        // boundary, can never show up in the venue-only local POI pool) --
        // may still be found through the independent global (Nominatim)
        // path below. This never loosens identity verification: the global
        // candidate goes through the exact same strict gate; it only gives
        // the hint a second, independent source to be found in. Kept
        // (rather than discarded) so a rejected local match is still the
        // reported outcome if the global path ALSO fails.
        unconfirmedLocalMatch = this.unconfirmedEntity(
          hint,
          resolvedEntity.provider,
        );
      } else if (!areaDestinationBlock) {
        recordAttempt(
          'LOCAL_OSM_POOL',
          {
            ...localOsmFacts,
          },
          undefined,
        );
      }

      // Build the explicit identity-acquisition authorization before any
      // external call. Strategy execution below is governed exclusively by
      // this plan; a provider miss/failure never authorizes another provider.
      const identityPlan = buildIdentityAcquisitionPlan({
        hintKey: hint.key,
        expectedKind: hint.expectedKind,
        geographicAuthorization,
        externalAcquisitionAuthorized:
          destinationAssociationVerified || componentScope.candidateOwned,
        countryCode: destinationCountryCode,
      });
      if (authorizesIdentityStrategy(identityPlan, 'NOMINATIM')) {
        const nominatimResolved = await this.resolveViaNominatim(
          hint,
          destinationScope,
          destinationCountryCode,
          componentScope,
          identityContext,
        );
        if (
          (nominatimResolved.status === 'candidate' ||
            nominatimResolved.status === 'no_candidate') &&
          nominatimResolved.competitorPool
        ) {
          competition.pools.push(nominatimResolved.competitorPool);
        }
        if (nominatimResolved.status === 'candidate') {
          const verification = await this.isVerified(
            'NOMINATIM',
            nominatimResolved.candidate,
            hint,
            observations,
            seenIdentities,
            [],
            identityContext,
            competition,
          );
          recordAttempt(
            'NOMINATIM',
            {
              status: 'completed',
              provider: nominatimResolved.provider,
              query: nominatimResolved.query,
              providerResultCount: nominatimResolved.providerResultCount,
              entity: nominatimResolved.candidate,
            },
            verification,
          );
          if (verification.decision.status === 'VERIFIED') {
            const resolved = await this.persistVerifiedCandidate(
              nominatimResolved.candidate,
            );
            entities.push(resolved);
            finishAudit(resolved);
            return;
          }
          // A rejected global candidate is evidence that THIS attempt was
          // insufficient, not that the hint has no resolvable entity. In
          // particular, an AREA proposal can still be a real PLACE found by
          // the bounded local kind-correction below. Preserve the failed
          // result only as the final diagnostic if every later strategy also
          // fails; never make it terminal.
          unconfirmedGlobalMatch = this.unconfirmedEntity(
            hint,
            nominatimResolved.provider,
          );
        } else if (nominatimResolved.status === 'no_candidate') {
          recordAttempt(
            'NOMINATIM',
            { ...nominatimResolved, status: 'no_candidate' },
            undefined,
          );
          if (nominatimResolved.destinationCompatibility) {
            areaDestinationBlock = nominatimResolved.destinationCompatibility;
          }
        } else if (nominatimResolved.status === 'failed') {
          recordAttempt('NOMINATIM', nominatimResolved, undefined);
        }

        // A Nominatim result that failed identity verification is a failed
        // attempt, not evidence that the independently allowed PLACE lookup
        // cannot succeed. Keep this ordering explicit: acquire, verify, then
        // continue to the next strategy on any non-verified decision.
      }

      if (authorizesIdentityStrategy(identityPlan, 'PLACES')) {
        const placesResolved = await this.resolveViaPlaces(
          hint,
          destinationScope,
          componentScope,
          identityContext,
        );
        if (
          (placesResolved.status === 'candidate' ||
            placesResolved.status === 'no_candidate') &&
          placesResolved.competitorPool
        ) {
          competition.pools.push(placesResolved.competitorPool);
        }
        if (placesResolved.status === 'candidate') {
          const verification = await this.isVerified(
            'PLACES',
            placesResolved.candidate,
            hint,
            observations,
            seenIdentities,
            [],
            identityContext,
            competition,
          );
          recordAttempt(
            'PLACES',
            {
              status: 'completed',
              provider: placesResolved.provider,
              query: placesResolved.query,
              providerResultCount: placesResolved.providerResultCount,
              entity: placesResolved.candidate,
              placeSearch: placesResolved.placeSearch,
            },
            verification,
          );
          if (verification.decision.status === 'VERIFIED') {
            const resolved = await this.persistVerifiedCandidate(
              placesResolved.candidate,
            );
            entities.push(resolved);
            finishAudit(resolved);
            return;
          }
          unconfirmedGlobalMatch = this.unconfirmedEntity(
            hint,
            placesResolved.provider,
          );
        } else if (
          placesResolved.status === 'no_candidate' ||
          placesResolved.status === 'failed'
        ) {
          recordAttempt(
            'PLACES',
            { ...placesResolved, status: placesResolved.status },
            undefined,
          );
        }
      }

      if (
        authorizesIdentityStrategy(identityPlan, 'OVERTURE_IDENTITY') &&
        this.overturePlaces &&
        identityPlan.countryCode
      ) {
        try {
          const lookup = await this.overturePlaces.lookupExactPlace({
            hintKey: hint.key,
            hintName: hint.name,
            countryCode: identityPlan.countryCode,
            role: hint.role,
          });
          competition.pools.push({
            strategy: 'OVERTURE_IDENTITY',
            coverage:
              lookup.coverage === 'COMPLETE_COUNTRY' ? 'COMPLETE' : 'PARTIAL',
            members: lookup.candidates.map(competitorMemberOf),
          });
          const overture = this.selectPoolCandidate(
            lookup.candidates,
            identityContext,
            enumeratedSnapshotLocalityCoverage(identityContext, {
              completeCountry: lookup.coverage === 'COMPLETE_COUNTRY',
              extent: lookup.enumeratedExtent,
            }),
            componentScope,
            destinationScope,
            destinationCountryCode,
          );
          if (overture.candidate) {
            const verification = await this.isVerified(
              'OVERTURE_IDENTITY',
              overture.candidate,
              hint,
              observations,
              seenIdentities,
              [],
              identityContext,
              competition,
            );
            recordAttempt(
              'OVERTURE_IDENTITY',
              {
                status: 'completed',
                provider: 'overture',
                query: hint.name,
                providerResultCount: lookup.resultCount,
                entity: overture.candidate,
              },
              verification,
            );
            if (verification.decision.status === 'VERIFIED') {
              const resolved = await this.persistVerifiedCandidate(
                overture.candidate,
              );
              entities.push(resolved);
              finishAudit(resolved);
              return;
            }
            unconfirmedGlobalMatch = this.unconfirmedEntity(
              hint,
              overture.candidate.provider,
            );
          } else {
            recordAttempt(
              'OVERTURE_IDENTITY',
              {
                status: 'no_candidate',
                provider: 'overture',
                query: hint.name,
                providerResultCount: lookup.resultCount,
                ...(overture.destinationCompatibility
                  ? {
                      destinationCompatibility:
                        overture.destinationCompatibility,
                    }
                  : {}),
              },
              undefined,
            );
          }
        } catch (error) {
          recordAttempt(
            'OVERTURE_IDENTITY',
            {
              status: 'failed',
              provider: 'overture',
              query: hint.name,
              failureReason:
                error instanceof Error ? error.message : String(error),
              failureStage: 'provider_search',
            },
            undefined,
          );
        }
      }

      // Real, live-measured pattern: a discovery hint tagged role="area"
      // (a district/neighborhood) that is actually a point-like place (a
      // plaza, monument, square) -- neither the destination-wide boundary
      // nor a Nominatim administrative-area search can ever match it, even
      // though the real entity sits right there in the local POI pool.
      // Retry once against that pool, as a venue, before giving up. Never
      // widens what counts as a match or loosens confirmation -- the
      // corrected entity still goes through the exact same
      // matchOsmCandidateByName + IdentityVerifier gate a genuine venue hint
      // does; this only gives the hint a second, correctly-scoped pool to
      // be found in.
      if (isAreaHint) {
        const poiLookup = await getPoiLookup(componentScope.poolBoundary);
        const venueFallbackMatch = matchOsmCandidateByName(
          hint.name,
          poiLookup.value,
          hint.addressHint,
        );
        if (venueFallbackMatch) {
          const correctedHint = {
            ...hint,
            role: 'venue' as const,
            expectedKind: 'PLACE' as const,
          };
          if (poiLookup.status === 'success') {
            competition.pools.push(
              this.localCompetitorPool(
                'AREA_TO_PLACE_CORRECTION',
                correctedHint.name,
                poiLookup.value,
                componentScope,
              ),
            );
          }
          const resolvedEntity = this.buildOsmCandidate(
            correctedHint,
            venueFallbackMatch,
            this.localPoolNameMultiplicity(
              correctedHint.name,
              poiLookup.value,
              componentScope,
            ),
          );
          const verification = await this.isVerified(
            'AREA_TO_PLACE_CORRECTION',
            resolvedEntity,
            correctedHint,
            observations,
            seenIdentities,
            [],
            identityContext,
            competition,
          );
          recordAttempt(
            'AREA_TO_PLACE_CORRECTION',
            {
              ...this.localOsmAuditFacts(poiLookup),
              provider: resolvedEntity.provider,
              entity: resolvedEntity,
            },
            verification,
          );
          entities.push(
            verification.decision.status === 'VERIFIED'
              ? await this.persistVerifiedCandidate(resolvedEntity)
              : this.unconfirmedEntity(correctedHint, resolvedEntity.provider),
          );
          finishAudit(entities[entities.length - 1]);
          return;
        } else if (isAreaHint) {
          recordAttempt(
            'AREA_TO_PLACE_CORRECTION',
            {
              ...this.localOsmAuditFacts(poiLookup),
            },
            undefined,
          );
        }
      }

      if (unconfirmedCatalogMatch) {
        entities.push(unconfirmedCatalogMatch);
        finishAudit(unconfirmedCatalogMatch);
        return;
      }
      if (unconfirmedLocalMatch) {
        entities.push(unconfirmedLocalMatch);
        finishAudit(unconfirmedLocalMatch);
        return;
      }
      if (unconfirmedGlobalMatch) {
        entities.push(unconfirmedGlobalMatch);
        finishAudit(unconfirmedGlobalMatch);
        return;
      }

      if (areaDestinationBlock) {
        entities.push({
          hintKey: hint.key,
          hintName: hint.name,
          provider: 'openstreetmap',
          externalId: '',
          role: hint.role,
          nameEvidenceMultiplicity: {
            exactName: 'UNKNOWN',
            declaredAlias: 'UNKNOWN',
          },
          status: 'unresolved',
          reason:
            areaDestinationBlock.verdict === 'INCOMPATIBLE'
              ? 'DESTINATION_INCOMPATIBLE'
              : 'DESTINATION_COMPATIBILITY_UNKNOWN',
        });
        finishAudit(entities[entities.length - 1]);
        return;
      }

      const lookup = await getPoiLookup(componentScope.poolBoundary);
      // A strategy whose provider could not run leaves "nothing found"
      // unproven: that is a provider failure, not an empty match.
      const reason =
        lookup.status === 'failed'
          ? 'OSM_PROVIDER_FAILED'
          : attempts.some((attempt) => attempt.executionStatus === 'failed')
            ? 'PROVIDER_FAILURE'
            : lookup.value.length === 0
              ? 'OSM_QUERY_EMPTY'
              : 'NO_OSM_MATCH';
      entities.push({
        hintKey: hint.key,
        hintName: hint.name,
        provider: 'openstreetmap',
        externalId: '',
        role: hint.role,
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'UNKNOWN',
        },
        status: 'unresolved',
        reason,
      });

      finishAudit(entities[entities.length - 1]);
    };

    // Two-phase resolution (spec 2026-10-02 Part II §P2-7):
    //  Phase 1 resolves the source-backed SCOPE hints (`area` / `route`
    //  roles) — destination-bounded, except that a ROUTE_LIKE candidate's
    //  AREA hint is searched within the destination COUNTRY (a real
    //  authority, never a radius), homonyms failing closed.
    //  Phase 2 resolves venue/waypoint components bounded by the scope the
    //  single owner derives from phase 1 — the same scope that later judges
    //  them in geographic validation.
    const hints: GeoEntityHint[] = candidate?.componentHints ?? [];
    const isScopeHint = (hint: GeoEntityHint) =>
      hint.role === 'area' ||
      hint.role === 'route' ||
      hint.expectedKind === 'AREA' ||
      hint.expectedKind === 'ROUTE';
    const destinationAcquisition = this.componentAcquisitionScope(
      { scope: { kind: 'UNKNOWN', reason: 'DESTINATION_GEOGRAPHY_UNKNOWN' } },
      destinationScope,
      entityResolutionScope,
      entities,
      false,
    );
    for (const hint of hints.filter(isScopeHint)) {
      await resolveHint(hint, {
        ...destinationAcquisition,
        countryBoundedAreaSearch:
          geographicAuthorization.kind === 'ROUTE_LIKE' &&
          (hint.role === 'area' || hint.expectedKind === 'AREA'),
      });
    }
    const derivedScope = deriveExperienceGeographicScope({
      candidate: { componentHints: hints },
      resolvedEntities: entities,
      authorization: geographicAuthorization,
      destination: destinationScope,
      workUnitScope,
    });
    // §P2-18: a ROUTE_LIKE composition not bound by a STRICT user anchor
    // may extend beyond the destination with no enclosing canonical scope;
    // its members may then be acquired by a provider query bounded to the
    // destination COUNTRY — never by a radius or an unbounded search.
    const memberAcquisition = this.componentAcquisitionScope(
      derivedScope,
      destinationScope,
      entityResolutionScope,
      entities,
      mayExtendBeyondDestination(geographicAuthorization, workUnitScope) &&
        Boolean(destinationCountryCode),
    );
    for (const hint of hints.filter((hint) => !isScopeHint(hint))) {
      await resolveHint(hint, memberAcquisition);
    }
    // Restore source order: persisted component order and every audit are
    // keyed to the source composition, never to resolution phase order.
    const sourceIndex = (hintKey: string) =>
      hints.findIndex((hint) => hint.key === hintKey);
    entities.sort((a, b) => sourceIndex(a.hintKey) - sourceIndex(b.hintKey));
    componentAudits.sort(
      (a, b) => sourceIndex(a.hintKey) - sourceIndex(b.hintKey),
    );
    const componentSearchScope = projectExperienceGeographicScope(derivedScope);
    await this.rememberVerifiedHints(verifiedHintsToRemember);
    // Source composition is the authority on WHICH components make up this
    // Experience. A candidate is admitted to geographic validation (and so
    // to persistence) only when every source-backed component hint has a
    // resolved canonical identity. An unresolved/ambiguous component is kept
    // as an explicit fact (see componentResolution), never dropped to
    // produce a smaller composite the source never described.
    const componentHints: GeoEntityHint[] = candidate?.componentHints ?? [];
    const sourceCompositionComplete =
      componentHints.length > 0 &&
      componentHints.every((hint) =>
        entities.some(
          (entity) =>
            entity.hintKey === hint.key && entity.status === 'resolved',
        ),
      );
    const resolvedEntities = entities.filter(
      (entity) => entity.status === 'resolved',
    );

    if (resolvedEntities.length === 0 || !sourceCompositionComplete) {
      return {
        resolved: {
          candidate,
          status: 'rejected' as const,
          resolvedEntities: entities,
          destinationAssociationVerified,
          // Nothing resolved: the candidate's reasons are every component's
          // own distinct final reason, in source order. A single summary
          // reason used to mask the others (an acquired-but-unconfirmed,
          // ambiguous, conflicted or provider-failed component collapsed
          // into NO_OSM_MATCH -- amendment §13).
          rejectionReasons: [
            ...(resolvedEntities.length === 0
              ? [
                  ...new Set(
                    entities.map((entity) => entity.reason ?? 'NO_OSM_MATCH'),
                  ),
                ]
              : ['INCOMPLETE_SOURCE_COMPOSITION']),
          ],
        },
        audit: {
          candidateTraceKey: traceCandidateKey(candidate),
          candidateName: candidate.name,
          candidateEvidenceKeys: [...candidate.evidenceKeys],
          candidateHintKeys: candidate.componentHints.map(
            (hint: any) => hint.key,
          ),
          componentAudits,
          geographicAuthorization,
          componentSearchScope,
        },
      };
    }

    return {
      resolved: {
        candidate,
        status: 'accepted' as const,
        resolvedEntities: entities,
        destinationAssociationVerified,
        rejectionReasons: [],
      },
      audit: {
        candidateTraceKey: traceCandidateKey(candidate),
        candidateName: candidate.name,
        candidateEvidenceKeys: [...candidate.evidenceKeys],
        candidateHintKeys: candidate.componentHints.map(
          (hint: any) => hint.key,
        ),
        componentAudits,
        geographicAuthorization,
        componentSearchScope,
      },
    };
  }

  /**
   * The phase-2 acquisition geography for a derived scope: the known scope
   * itself, or — when the candidate's scope is UNKNOWN — the destination
   * (destination-local search only, §P2-10: never a scoped widening).
   */
  private componentAcquisitionScope(
    derived: DerivedExperienceGeographicScope,
    destinationScope: GeographicScope,
    entityResolutionScope: GeographicScope,
    entities: ResolvedGeoEntity[],
    admitsCountryBoundedBeyondDestination: boolean,
  ): ComponentAcquisitionScope {
    const destinationOnly = deriveExperienceGeographicScope({
      candidate: { componentHints: [] },
      resolvedEntities: [],
      authorization: DEFAULT_GEOGRAPHIC_AUTHORIZATION,
      destination: destinationScope,
    }).scope;
    const destinationWindow = scopeSearchWindow(destinationOnly);
    const poolWindow =
      entityResolutionScope === destinationScope
        ? destinationWindow
        : geographicScopeSearchWindow(
            entityResolutionScope,
            'WORK_UNIT_ANCHOR',
          );
    const scope =
      derived.scope.kind !== 'UNKNOWN' &&
      derived.scope.kind !== 'SOURCE_DEFINED_COMPONENTS'
        ? derived.scope
        : destinationOnly;
    if (
      scope.kind === 'UNKNOWN' ||
      scope.kind === 'SOURCE_DEFINED_COMPONENTS'
    ) {
      // No destination geography at all: no window, no scope; providers run
      // country-bounded only and admission defers to the destination policy
      // (UNKNOWN excludes nothing). Nothing is admitted by a fabricated scope.
      return {
        candidateOwned: false,
        countryBoundedAreaSearch: false,
        admitsCountryBoundedBeyondDestination: false,
      };
    }
    // A verified candidate-owned scope, or a regional work-unit anchor
    // acting as the Experience scope, bounds the search itself.
    const candidateOwned =
      scope.provenance === 'CANDIDATE_AREA' ||
      scope.provenance === 'CANDIDATE_ROUTE' ||
      scope.provenance === 'WORK_UNIT_ANCHOR';
    const window = scopeSearchWindow(scope);
    // The destination (or anchor) OSM pool already covers an AREA lying
    // inside the destination; only an AREA reaching beyond it needs its own
    // within-area pool, addressable through its real OSM area identity.
    const poolBoundary =
      scope.kind === 'AREA' &&
      scope.provenance === 'CANDIDATE_AREA' &&
      derived.ownedScopeDestinationRelation !== 'INSIDE'
        ? osmAreaOf(
            entities.find(
              (entity) =>
                entity.status === 'resolved' &&
                entity.geometry === scope.geometry,
            ),
          )
        : undefined;
    return {
      scope,
      window,
      catalogPlaceWindow: candidateOwned ? window : poolWindow,
      destinationWindow,
      ...(poolBoundary ? { poolBoundary } : {}),
      candidateOwned,
      countryBoundedAreaSearch: false,
      admitsCountryBoundedBeyondDestination,
    };
  }

  /**
   * Records verified hint memory for components that resolved VERIFIED
   * through external acquisition, so a later request carrying the same
   * hint text reuses the canonical GeoEntity catalog-first even when the
   * text differs from its canonical name ("Farmacia la Estrella" ->
   * "Farmacia de la Estrella"). Best-effort: the identity decision and
   * persistence already happened, so a failed memory write only costs a
   * future re-acquisition and never fails this resolution. The outcome is
   * recorded on the component audit.
   */
  private async rememberVerifiedHints(
    pending: Array<{
      audit: ComponentResolutionAudit;
      geoEntityId: string;
      hintName: string;
    }>,
  ): Promise<void> {
    for (const { audit, geoEntityId, hintName } of pending) {
      try {
        const outcome = await this.catalog.rememberVerifiedHintName(
          geoEntityId,
          hintName,
        );
        if (outcome !== 'EMPTY_KEY') audit.verifiedHintMemory = outcome;
      } catch (error) {
        audit.verifiedHintMemory = 'FAILED';
        this.logger.warn(
          `Verified hint memory write failed for "${hintName}" -> GeoEntity ${geoEntityId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** Builds/acquires normalized identity facts; only IdentityVerifier judges them. */
  private async isVerified(
    strategy: ResolutionStrategy,
    entity: EntityCandidate,
    hint: any,
    observations: SourceObservation[] = [],
    seenIdentities?: SeenIdentities,
    acquisitionEvidence: IdentityEvidence[] = [],
    context: ComponentIdentityContext = {},
    competition?: HintCompetition,
  ): Promise<VerificationResult> {
    const evidence = [
      ...buildLocalIdentityEvidence(hint, entity, observations),
      ...contextualIdentityEvidence(context, entity),
      ...acquisitionEvidence,
      // Competitors are a fact about the HINT: every pool examined for it
      // so far, in whatever order, judged against this candidate. Before any
      // pool (catalog or trusted-observation reuse) nothing was examined,
      // which the verifier already reads as "not established".
      ...(competition?.pools.length
        ? [
            examineCompetitors({
              hintName: hint.name,
              expectedKind: hint.expectedKind,
              candidate: entity,
              pools: competition.pools,
              context,
              admits: competition.admits,
            }),
          ]
        : []),
      // Where this candidate's name uniqueness is grounded. Without a
      // competition (a structural route) no uniqueness rule applies.
      ...(competition
        ? [
            geographicCorrespondence(
              context,
              entity,
              competition.admission,
              competition.sourceArea,
            ),
          ]
        : []),
    ];
    if (seenIdentities) {
      // Strong-identity correlation: the candidate's identity SET (e.g.
      // Geoapify's own handle + the OSM object and QID its Place Details
      // declared) against every identity an EARLIER, different strategy
      // acquired for this same hint. Keys are namespace + canonical id
      // (`openstreetmap/osm:node:3348573778`): the namespace is the
      // identity provider, never the acquisition strategy, so Nominatim's
      // and Geoapify's views of one OSM node share a key while `osm:node:1`
      // and `osm:way:1` never do. Exact equality only -- no names, no
      // coordinates, no count of agreeing providers. Whether the two
      // observations are independent is part of the same fact: their
      // records' evidence origins.
      const identities = strongIdentitiesOf(entity);
      const current: ConvergenceObservation = {
        strategy,
        origins: entity.evidenceOrigins ?? [],
      };
      // Every earlier observation by a different strategy on any shared
      // key; an independent one is preferred, so a record first found
      // twice through one origin does not hide a later independent one.
      const convergences = identities.flatMap((identity) =>
        (seenIdentities.get(strongIdentityKey(identity)) ?? [])
          .filter((prior) => prior.strategy !== strategy)
          .map((prior) => ({
            type: 'IDENTITY_CONVERGENCE' as const,
            priorStrategy: prior.strategy,
            identity,
            observations: [prior, current] as [
              ConvergenceObservation,
              ConvergenceObservation,
            ],
            independence: convergenceIndependence(
              prior.origins,
              current.origins,
            ),
          })),
      );
      const convergence =
        convergences.find(
          (item) => item.independence === 'INDEPENDENT_ORIGINS',
        ) ?? convergences[0];
      if (convergence) evidence.push(convergence);
      for (const identity of identities) {
        const key = strongIdentityKey(identity);
        seenIdentities.set(key, [...(seenIdentities.get(key) ?? []), current]);
      }
    }
    const attempt: ResolutionAttempt = {
      strategy,
      candidate: entity,
      evidence,
    };
    const directDecision = this.identityVerifier.decide(hint, attempt);
    if (directDecision.status === 'VERIFIED') {
      return { decision: directDecision, evidence: [...attempt.evidence] };
    }
    attempt.evidence.push(
      ...(await this.identityEvidenceCollector.collect(
        hint,
        entity,
        observations,
      )),
    );
    return {
      decision: this.identityVerifier.decide(hint, attempt),
      evidence: [...attempt.evidence],
    };
  }

  private async persistVerifiedCandidate(
    candidate: EntityCandidate,
  ): Promise<ResolvedGeoEntity> {
    if (candidate.identities?.length) {
      const persisted = await this.catalog.upsertGeoEntityWithIdentities({
        name: candidate.canonicalName,
        kind: candidate.kind,
        identities: candidate.identities,
        latitude: candidate.latitude ?? undefined,
        longitude: candidate.longitude ?? undefined,
        // A Point for a PLACE, a MultiLineString for a multi-way ROUTE.
        geometry: candidate.geometry as GeoJsonGeometry,
        metadata: candidate.persistenceMetadata,
      });
      if (persisted.status === 'IDENTITY_CONFLICT') {
        // The candidate's strong identities are already owned by 2+
        // different GeoEntities: never merged, never a name/proximity
        // winner -- fail closed.
        this.logger.warn(
          `IDENTITY_CONFLICT persisting "${candidate.canonicalName}" for hint "${candidate.hintName}": identities ${strongIdentitiesOf(
            candidate,
          )
            .map(strongIdentityKey)
            .join(
              ', ',
            )} are owned by GeoEntities ${persisted.conflictingGeoEntityIds.join(', ')}`,
        );
        return this.identityConflictEntity(candidate);
      }
      return {
        ...this.resolvedFromCandidate(candidate, persisted.geoEntity.id),
        persistence: {
          status: persisted.status,
          attachedExternalIds: persisted.attachedExternalIds,
        },
      };
    }
    const geo = await this.catalog.upsertGeoEntity({
      name: candidate.canonicalName,
      kind: candidate.kind,
      provider: candidate.provider,
      externalId: candidate.externalId,
      latitude: candidate.latitude ?? undefined,
      longitude: candidate.longitude ?? undefined,
      geometry: candidate.geometry,
      metadata: candidate.persistenceMetadata,
    });
    return {
      hintKey: candidate.hintKey,
      hintName: candidate.hintName,
      provider: candidate.provider,
      externalId: candidate.externalId,
      canonicalName: candidate.canonicalName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      geometry: candidate.geometry,
      role: candidate.role,
      kind: candidate.kind,
      wikidataQid: candidate.wikidataQid,
      nameAliasCandidates: candidate.nameAliasCandidates,
      addressConfirmed: candidate.addressConfirmed,
      nameEvidenceMultiplicity: candidate.nameEvidenceMultiplicity,
      adminContext: candidate.adminContext,
      status: 'resolved',
      geoEntityId: geo.id,
    };
  }

  /**
   * Stage 3 catalog-first counterpart to `persistVerifiedCandidate`: the
   * canonical GeoEntity was already established by an earlier acquisition
   * (this run or a prior one) and IdentityVerifier just accepted it again
   * for this hint, so this reuses `geoEntityId` directly rather than
   * calling `upsertGeoEntity` -- there is no new provider fact to
   * reconcile and no duplicate write to make.
   */
  private reuseCatalogGeoEntity(
    candidate: EntityCandidate,
    geoEntityId: string,
  ): ResolvedGeoEntity {
    return {
      hintKey: candidate.hintKey,
      hintName: candidate.hintName,
      provider: candidate.provider,
      externalId: candidate.externalId,
      canonicalName: candidate.canonicalName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      geometry: candidate.geometry,
      role: candidate.role,
      kind: candidate.kind,
      wikidataQid: candidate.wikidataQid,
      nameAliasCandidates: candidate.nameAliasCandidates,
      addressConfirmed: candidate.addressConfirmed,
      nameEvidenceMultiplicity: candidate.nameEvidenceMultiplicity,
      adminContext: candidate.adminContext,
      status: 'resolved',
      geoEntityId,
    };
  }

  /**
   * A match that failed confirmation must never carry a `geoEntityId`
   * forward — every call site downstream (dedupeResolvedEntitiesByGeoEntity,
   * persistVerifiedExperience's `components` mapping) already filters on
   * `status === 'resolved'`, so degrading straight to `unresolved` here is
   * sufficient on its own; no other call site needs to change.
   */
  private unconfirmedEntity(hint: any, provider: string): ResolvedGeoEntity {
    return {
      hintKey: hint.key,
      hintName: hint.name,
      provider,
      externalId: '',
      role: hint.role,
      nameEvidenceMultiplicity: {
        exactName: 'UNKNOWN',
        declaredAlias: 'UNKNOWN',
      },
      status: 'unresolved',
      reason: 'UNCONFIRMED_MATCH',
    };
  }

  private resolvedFromCandidate(
    candidate: EntityCandidate,
    geoEntityId: string,
  ): ResolvedGeoEntity {
    return {
      hintKey: candidate.hintKey,
      hintName: candidate.hintName,
      provider: candidate.provider,
      externalId: candidate.externalId,
      canonicalName: candidate.canonicalName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      geometry: candidate.geometry,
      role: candidate.role,
      kind: candidate.kind,
      wikidataQid: candidate.wikidataQid,
      nameAliasCandidates: candidate.nameAliasCandidates,
      addressConfirmed: candidate.addressConfirmed,
      nameEvidenceMultiplicity: candidate.nameEvidenceMultiplicity,
      adminContext: candidate.adminContext,
      status: 'resolved',
      geoEntityId,
    };
  }

  private identityConflictEntity(hint: {
    hintKey?: string;
    key?: string;
    hintName?: string;
    name?: string;
    role: ResolvedGeoEntity['role'];
  }): ResolvedGeoEntity {
    return {
      hintKey: (hint.hintKey ?? hint.key) as string,
      hintName: (hint.hintName ?? hint.name) as string,
      provider: 'openstreetmap',
      externalId: '',
      role: hint.role,
      nameEvidenceMultiplicity: {
        exactName: 'UNKNOWN',
        declaredAlias: 'UNKNOWN',
      },
      status: 'unresolved',
      reason: 'IDENTITY_CONFLICT',
    };
  }

  /**
   * AREA candidate vs the single destination policy: the candidate's own
   * representative point, plus its own admin identity/level when it is an
   * administrative unit.
   */
  private areaDestinationCompatibility(
    area: OsmCandidate,
    destinationScope: GeographicScope,
    probe?: Coordinates,
  ): DestinationCompatibility {
    const point = probe ?? this.representativePoint(area);
    const adminLevel = Number(area.tags?.admin_level);
    return evaluateDestinationCompatibility(
      {
        probePoints: point ? [point] : [],
        self: {
          osmType: area.osmType,
          osmId: area.osmId,
          ...(Number.isFinite(adminLevel) ? { adminLevel } : {}),
        },
      },
      destinationScope,
    );
  }

  /**
   * ROUTE acquisition -> correlation -> verification -> persistence:
   *  1. targeted OSM route resolution over the destination;
   *  2. strong-identity correlation of the RESOLVED cluster's segment ids
   *     against persisted GeoEntityIdentity rows (0 -> new, 1 -> reuse,
   *     2+ -> IDENTITY_CONFLICT, fail closed);
   *  3. IdentityVerifier judges the typed STRUCTURED_ROUTE_RESOLUTION fact;
   *  4. one GeoEntity + one identity per real OSM way.
   */
  private async resolveViaTargetedRoute(
    hint: any,
    destinationScope: GeographicScope,
    observations: SourceObservation[],
    seenIdentities: SeenIdentities,
  ): Promise<{
    entity: ResolvedGeoEntity;
    acquisition: {
      status: 'completed' | 'failed' | 'no_candidate';
      provider: string;
      query: string;
      providerResultCount?: number;
      poolCandidateCount?: number;
      entity?: EntityCandidate;
      failureReason?: string;
      routeResolution: NonNullable<ResolutionAttemptAudit['routeResolution']>;
    };
    verification?: VerificationResult;
  }> {
    const result = await this.targetedRouteResolver.resolve({
      name: hint.name,
      destination: destinationScope,
    });
    const routeResolution: NonNullable<
      ResolutionAttemptAudit['routeResolution']
    > = {
      status: result.status,
      reason: result.reason,
      variants: result.variants.map((v) => ({
        variant: v.variant,
        name: v.name,
        rawCount: v.rawCount,
        acceptedCount: v.acceptedCount,
      })),
      clusterCount: result.clusters.length,
      compatibleClusterCount: result.compatibleClusterCount,
      ...(result.resolved
        ? { resolvedSegmentCount: result.resolved.segmentExternalIds.length }
        : {}),
    };
    const acquisitionBase = {
      provider: 'openstreetmap',
      query: result.variants.map((v) => v.name).join(' | ') || hint.name,
      providerResultCount: result.variants.reduce(
        (sum, v) => sum + v.rawCount,
        0,
      ),
      poolCandidateCount: result.clusters.length,
      routeResolution,
    };
    const unresolved = (reason: string): ResolvedGeoEntity => ({
      hintKey: hint.key,
      hintName: hint.name,
      provider: 'openstreetmap',
      externalId: '',
      role: hint.role,
      nameEvidenceMultiplicity: {
        exactName: 'UNKNOWN',
        declaredAlias: 'UNKNOWN',
      },
      status: 'unresolved',
      reason,
    });

    if (result.status !== 'RESOLVED' || !result.resolved) {
      return {
        entity: unresolved(
          result.status === 'RESOLVED'
            ? 'NO_OSM_MATCH'
            : TARGETED_ROUTE_UNRESOLVED_REASON[result.status],
        ),
        acquisition: {
          ...acquisitionBase,
          status: result.status === 'UNAVAILABLE' ? 'failed' : 'no_candidate',
          ...(result.status === 'UNAVAILABLE'
            ? {
                failureReason:
                  result.variants.find((v) => v.failureReason)?.failureReason ??
                  result.reason,
              }
            : {}),
        },
      };
    }

    const cluster = result.resolved;
    const knownGeoEntityIds = await this.catalog.findGeoEntityIdsByIdentities(
      'openstreetmap',
      cluster.segmentExternalIds,
    );
    routeResolution.knownGeoEntityCount = knownGeoEntityIds.length;
    if (knownGeoEntityIds.length > 1) {
      return {
        entity: unresolved('IDENTITY_CONFLICT'),
        acquisition: { ...acquisitionBase, status: 'no_candidate' },
      };
    }

    const candidate = buildRouteClusterCandidate(hint, cluster);
    const verification = await this.isVerified(
      'TARGETED_ROUTE',
      candidate,
      hint,
      observations,
      seenIdentities,
      [structuredRouteEvidence(cluster)],
    );
    const acquisition = {
      ...acquisitionBase,
      status: 'completed' as const,
      entity: candidate,
    };
    if (verification.decision.status !== 'VERIFIED') {
      return {
        entity: this.unconfirmedEntity(hint, 'openstreetmap'),
        acquisition,
        verification,
      };
    }
    return {
      entity: await this.persistVerifiedCandidate(candidate),
      acquisition,
      verification,
    };
  }

  /**
   * Whether a pool bounded to the destination (the local OSM pool, a Places
   * circle around the scope window) examined every location this component
   * may be admitted at. For a destination-bounded Experience it did -- the
   * accepted single-destination contract (P0.2, Galería Güemes G1). For an
   * Experience admitted beyond the destination (§P2-18) the admission scope
   * is the country, so the same pool is only PARTIAL; so is any pool when
   * the destination has no usable geography.
   */
  private destinationPoolCoverage(
    componentScope: ComponentAcquisitionScope,
  ): CompetitorPoolCoverage {
    return componentScope.scope &&
      !componentScope.admitsCountryBoundedBeyondDestination
      ? 'COMPLETE'
      : 'PARTIAL';
  }

  /**
   * A competitor matters only where this component may be admitted: the
   * same canonical admission policy every strategy applies to its own
   * candidate. A member whose position is unknown stays material.
   */
  private admitsCompetitor(
    member: CompetitorPoolMember,
    componentScope: ComponentAcquisitionScope,
    destinationScope: GeographicScope,
    destinationCountryCode: string | undefined,
  ): boolean {
    if (
      !componentScope.scope ||
      !Number.isFinite(member.latitude) ||
      !Number.isFinite(member.longitude)
    ) {
      return true;
    }
    return admitComponentLocation(
      componentScope.scope,
      {
        latitude: member.latitude as number,
        longitude: member.longitude as number,
      },
      destinationScope,
      {
        countryBounded:
          componentScope.admitsCountryBoundedBeyondDestination &&
          Boolean(destinationCountryCode),
      },
    ).admitted;
  }

  /**
   * The local OSM POI pool as an examined competitor pool. Records that
   * record equivalence groups into one physical identity are ONE member
   * carrying every record's key, so a group never competes with itself and
   * counts once against another candidate.
   */
  private localCompetitorPool(
    strategy: ResolutionStrategy,
    hintName: string,
    pool: OsmCandidate[],
    componentScope: ComponentAcquisitionScope,
    grouping: RecordIdentityGrouping = RecordIdentityGrouping.none(),
  ): CompetitorPool {
    const aliasIds = new Set(
      aliasMatches(hintName, pool).map((candidate) => candidate.id),
    );
    const needle = normalizeGeoName(hintName);
    const byIdentity = new Map<string, OsmCandidate[]>();
    for (const candidate of pool) {
      const key = grouping.identityKeyOf(candidate.id);
      (byIdentity.get(key) ?? byIdentity.set(key, []).get(key)!).push(
        candidate,
      );
    }
    return {
      strategy,
      coverage: this.destinationPoolCoverage(componentScope),
      members: [...byIdentity.values()].map((records): CompetitorPoolMember => {
        // The record answering to the hint by name represents the
        // identity; otherwise its first record.
        const representative =
          records.find((record) => normalizeGeoName(record.name) === needle) ??
          records[0];
        const point = this.representativePoint(representative);
        return {
          identityKeys: records.map((record) =>
            strongIdentityKey({
              provider: 'openstreetmap',
              externalId: record.id,
            }),
          ),
          name: representative.name,
          ...(records.some((record) => aliasIds.has(record.id))
            ? { declaresHintAlias: true }
            : {}),
          ...(point ? point : {}),
          structuralKind: structuralKindFromOsmTags(representative.tags),
        };
      }),
    };
  }

  /**
   * Record equivalence for one pool, computed once per pool. Item facts
   * (physical location, names) are read only for items two or more
   * records declare; any lookup failure leaves them unknown, and unknown
   * facts group nothing (fail closed).
   */
  private readonly recordGroupings = new WeakMap<
    OsmCandidate[],
    Promise<RecordIdentityGrouping>
  >();

  private recordGroupingOf(
    pool: OsmCandidate[],
  ): Promise<RecordIdentityGrouping> {
    let grouping = this.recordGroupings.get(pool);
    if (!grouping) {
      grouping = this.computeRecordGrouping(pool);
      this.recordGroupings.set(pool, grouping);
    }
    return grouping;
  }

  private async computeRecordGrouping(
    pool: OsmCandidate[],
  ): Promise<RecordIdentityGrouping> {
    const records = pool.map(osmEquivalenceRecord);
    const qids = itemsNeedingFacts(records);
    const facts = new Map<string, EquivalenceItemFacts>();
    if (
      qids.length > 0 &&
      typeof this.wikidata?.lookupPhysicalLocation === 'function'
    ) {
      try {
        const [located, summaries] = await Promise.all([
          this.wikidata.lookupPhysicalLocation(qids),
          this.wikidata.getEntitySummaries(qids),
        ]);
        for (const qid of qids) {
          const location = located?.get(qid);
          const summary = summaries?.get(qid);
          if (!location || !summary) continue;
          facts.set(qid, {
            located: location.located,
            names: [summary.label, ...(summary.aliases ?? [])].filter(
              (name): name is string => Boolean(name),
            ),
          });
        }
      } catch (error) {
        this.logger.warn(
          `Record equivalence item facts unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return groupEquivalentRecords(records, facts);
  }

  /**
   * Exact-name / declared-alias multiplicity of the local POI pool, counted
   * in physical identities (record equivalence): a grouped identity counts
   * once, matches through any member's own name, and declares the names of
   * all its members.
   */
  private localPoolNameMultiplicity(
    hintName: string,
    pool: OsmCandidate[],
    componentScope: ComponentAcquisitionScope,
    grouping: RecordIdentityGrouping = RecordIdentityGrouping.none(),
  ): { exactName: IdentityMultiplicity; declaredAlias: IdentityMultiplicity } {
    const coverage = this.destinationPoolCoverage(componentScope);
    const needle = normalizeGeoName(hintName);
    const exact = pool.filter(
      (candidate) => needle && normalizeGeoName(candidate.name) === needle,
    );
    const aliased = aliasMatches(
      hintName,
      pool.map((candidate) => {
        const group = grouping.groupOf(candidate.id);
        return group
          ? {
              ...candidate,
              nameAliasCandidates: [
                ...new Set([
                  ...extractDeclaredNameAliases(candidate.tags),
                  ...group.declaredNames,
                ]),
              ],
            }
          : candidate;
      }),
    );
    return {
      exactName: poolMultiplicity(grouping.countIdentities(exact), coverage),
      declaredAlias: poolMultiplicity(
        grouping.countIdentities(aliased),
        coverage,
      ),
    };
  }

  private buildOsmCandidate(
    hint: any,
    matched: OsmCandidate,
    nameMultiplicity: {
      exactName: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
      declaredAlias: 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';
    },
    grouping: RecordIdentityGrouping = RecordIdentityGrouping.none(),
  ): EntityCandidate {
    // R2: a record grouped by record equivalence declares the names of its
    // whole physical identity; IdentityVerifier still grades each one.
    const group = grouping.groupOf(matched.id);
    const kind =
      hint.expectedKind === 'ROUTE'
        ? GeoEntityKind.ROUTE
        : hint.expectedKind === 'AREA'
          ? GeoEntityKind.AREA
          : GeoEntityKind.PLACE;
    const point = this.representativePoint(matched);
    return {
      hintKey: hint.key,
      hintName: hint.name,
      provider: 'openstreetmap',
      externalId: matched.id,
      canonicalName: matched.name,
      kind,
      latitude: point?.latitude,
      longitude: point?.longitude,
      geometry: matched.geometry,
      role: hint.role,
      wikidataQid: extractWikidataQid(matched.tags),
      nameAliasCandidates: group
        ? [
            ...new Set([
              ...extractDeclaredNameAliases(matched.tags),
              ...group.declaredNames.filter((name) => name !== matched.name),
            ]),
          ]
        : extractDeclaredNameAliases(matched.tags),
      addressConfirmed: matchesAddressHint(hint.addressHint, matched.tags),
      nameEvidenceMultiplicity: nameMultiplicity,
      structuralKind: structuralKindFromOsmTags(matched.tags),
      evidenceOrigins: [{ authority: 'openstreetmap', recordId: matched.id }],
      persistenceMetadata: { tags: matched.tags },
    };
  }

  /**
   * Candidate selection over an exact-name pool a provider returned whole
   * (Overture): the member the source context singles out, otherwise the
   * member nearest the scope window -- a choice of which record to TRY,
   * never identity evidence. The pool's contextual evaluation travels with
   * the candidate. A snapshot's spatial coverage is not a typed fact, so
   * the comparison is never known complete for a locality (it can expose
   * an equally consistent competitor, never single one out). The chosen
   * record then answers to the same scope admission as NOMINATIM/PLACES;
   * the lookup is bounded to the destination country, like theirs.
   */
  private selectPoolCandidate(
    pool: EntityCandidate[],
    context: ComponentIdentityContext,
    contextualCoverage: ContextualPoolCoverage,
    componentScope: ComponentAcquisitionScope,
    destinationScope: GeographicScope,
    destinationCountryCode: string | undefined,
  ): {
    candidate?: EntityCandidate;
    destinationCompatibility?: DestinationCompatibility;
  } {
    if (pool.length === 0) return {};
    const contextualPool = evaluateContextualPool(
      context,
      pool.map(
        (member): ContextualPoolMember => ({
          identityKey: candidateIdentityKey(member),
          latitude: member.latitude ?? undefined,
          longitude: member.longitude ?? undefined,
          structuralKind: member.structuralKind ?? 'UNKNOWN',
        }),
      ),
      contextualCoverage,
    );
    const distinguished = contextuallyDistinguishedKey(contextualPool);
    const center = componentScope.window?.center;
    const distanceTo = (member: EntityCandidate) =>
      center &&
      Number.isFinite(member.latitude) &&
      Number.isFinite(member.longitude)
        ? calculateDistance(center, {
            latitude: member.latitude as number,
            longitude: member.longitude as number,
          })
        : Infinity;
    const selected =
      (distinguished &&
        pool.find(
          (member) => candidateIdentityKey(member) === distinguished,
        )) ||
      [...pool].sort((a, b) => distanceTo(a) - distanceTo(b))[0];
    const admission = componentScope.scope
      ? admitComponentLocation(
          componentScope.scope,
          Number.isFinite(selected.latitude) &&
            Number.isFinite(selected.longitude)
            ? {
                latitude: selected.latitude as number,
                longitude: selected.longitude as number,
              }
            : undefined,
          destinationScope,
          {
            countryBounded:
              componentScope.admitsCountryBoundedBeyondDestination &&
              Boolean(destinationCountryCode),
          },
        )
      : { admitted: true as const };
    if (!admission.admitted) {
      return admission.reason === 'DESTINATION_INCOMPATIBLE'
        ? { destinationCompatibility: admission.destinationCompatibility }
        : {};
    }
    return {
      candidate: contextualPool ? { ...selected, contextualPool } : selected,
    };
  }

  /**
   * The component's identity context: the source-stated physical kind as
   * is, and the source-stated locality grounded in a real boundary. A
   * locality that cannot be grounded stays an explicit UNGROUNDED fact.
   */
  private async groundIdentityContext(
    hint: GeoEntityHint,
    countryCode: string | undefined,
  ): Promise<ComponentIdentityContext> {
    const context: ComponentIdentityContext = hint.physicalKindAssertion
      ? { physicalKind: hint.physicalKindAssertion }
      : {};
    const assertion = hint.localityAssertion;
    if (!assertion) return context;
    if (!this.localityGrounder) {
      return {
        ...context,
        locality: { status: 'UNGROUNDED', assertion, reason: 'NO_GROUNDER' },
      };
    }
    try {
      return {
        ...context,
        locality: await this.localityGrounder.groundLocality(
          assertion,
          countryCode,
        ),
      };
    } catch {
      return {
        ...context,
        locality: {
          status: 'UNGROUNDED',
          assertion,
          reason: 'PROVIDER_FAILURE',
        },
      };
    }
  }

  private localOsmAuditFacts(lookup: OsmLookupResult<OsmCandidate[]>): {
    status: 'completed' | 'failed';
    provider: 'openstreetmap';
    poolCandidateCount?: number;
    failureReason?: string;
  } {
    if (lookup.status === 'failed') {
      return {
        status: 'failed',
        provider: 'openstreetmap',
        failureReason: lookup.failureReason,
      };
    }

    return {
      status: 'completed',
      provider: 'openstreetmap',
      poolCandidateCount: lookup.value.length,
    };
  }

  private async resolveViaNominatim(
    hint: any,
    destinationScope: GeographicScope,
    destinationCountryCode: string | undefined,
    componentScope: ComponentAcquisitionScope,
    context: ComponentIdentityContext = {},
  ): Promise<StrategyAcquisitionResult> {
    if (!this.nominatim || hint.expectedKind === 'ROUTE') {
      return { status: 'not_applicable' };
    }

    try {
      // A ROUTE_LIKE candidate's AREA scope hint is searched within the
      // destination COUNTRY only — a real authority, never a radius: the
      // source names the area, the country bounds its homonyms, and
      // multiplicity inside the country fails closed in IdentityVerifier.
      // Every other hint is soft-biased toward the scope-derived window.
      const window = componentScope.countryBoundedAreaSearch
        ? undefined
        : componentScope.window;
      // Identity acquisition asks for the provider's whole result window:
      // the default window is ranked by global importance, so it can drop
      // the only contextually plausible same-name member before selection
      // and understate the exact-name multiplicity the verifier relies on.
      const searchOptions: NominatimSearchOptions = {
        resultWindow: 'PROVIDER_MAXIMUM',
        ...(destinationCountryCode
          ? { countryCode: destinationCountryCode }
          : {}),
        ...(window
          ? {
              bias: {
                center: window.center,
                radiusMeters: window.radiusMeters,
              },
            }
          : {}),
      };
      const results = await this.nominatim.search(hint.name, searchOptions);
      // A full window may have been cut off: it can neither establish that
      // a name is unique nor be a complete contextual comparison.
      const windowReached =
        results.length >= NOMINATIM_PROVIDER_MAXIMUM_RESULTS;
      const exactMatches = nominatimExactMatches(hint.name, results);
      const nominatimKey = (result: NominatimResult) =>
        `openstreetmap/osm:${result.osmType}:${result.osmId}`;
      const contextualPool = evaluateContextualPool(
        context,
        exactMatches.map(
          (result): ContextualPoolMember => ({
            identityKey: nominatimKey(result),
            ...(Number.isFinite(result.latitude) &&
            Number.isFinite(result.longitude)
              ? {
                  latitude: result.latitude as number,
                  longitude: result.longitude as number,
                }
              : {}),
            structuralKind: structuralKindFromNominatim(result),
          }),
        ),
        windowReached ? 'NOT_ESTABLISHED' : 'PROVIDER_WINDOW_NOT_REACHED',
      );
      // The member the source context singles out is the one tried;
      // otherwise the existing ranking picks a member to try. Neither
      // ranking nor proximity is ever identity evidence.
      const distinguishedKey = contextuallyDistinguishedKey(contextualPool);
      const match =
        (distinguishedKey &&
          exactMatches.find(
            (result) => nominatimKey(result) === distinguishedKey,
          )) ||
        bestNominatimMatch(hint.name, results, window?.center);
      // The search is bounded to the destination country (or unbounded),
      // so an answer the window did not cut off examined every location
      // the component may be admitted at.
      const coverage: CompetitorPoolCoverage = windowReached
        ? 'PARTIAL'
        : 'COMPLETE';
      // A record no Nominatim branch below could ever turn into a component
      // (a same-name road) is not a competitor of one.
      const competitorPool: CompetitorPool = {
        strategy: 'NOMINATIM',
        coverage,
        members: results
          .filter(
            (result) =>
              isAreaScaleEligible(result) || isPlaceScaleEligible(result),
          )
          .map(
            (result): CompetitorPoolMember => ({
              identityKeys: [nominatimKey(result)],
              name: result.displayName.split(',')[0]?.trim() ?? '',
              ...(Number.isFinite(result.latitude) &&
              Number.isFinite(result.longitude)
                ? {
                    latitude: result.latitude as number,
                    longitude: result.longitude as number,
                  }
                : {}),
              structuralKind: structuralKindFromNominatim(result),
            }),
          ),
      };
      const nameMultiplicity = {
        exactName: poolMultiplicity(exactMatches.length, coverage),
        declaredAlias: 'UNKNOWN' as const,
      };
      if (
        !match ||
        !Number.isFinite(match.latitude) ||
        !Number.isFinite(match.longitude)
      ) {
        return {
          status: 'no_candidate',
          provider: 'nominatim',
          query: hint.name,
          providerResultCount: results.length,
          competitorPool,
        };
      }

      // Generalized (was: gated behind `hint.expectedKind === 'AREA'`) --
      // the discovery LLM's expectedKind/role is only a proposal, never
      // ground truth. Nominatim's own structural evidence
      // (`isAreaScaleEligible`/`isPlaceScaleEligible` -- the same canonical
      // scope-acceptance predicates DestinationResolutionService/
      // AreaRouteAnchorResolverService use) decides whether a match is
      // area-scale or point-scale; `hint.expectedKind` only gated whether
      // Nominatim runs at all (ROUTE hints skip it, above). Real
      // regression this fixes: "Puerto Madero" tagged role="venue"/
      // expectedKind="PLACE" by discovery is a genuine neighborhood --
      // before this generalization it could only ever be persisted as a
      // point, never recognized as the area it structurally is.
      if (isAreaScaleEligible(match)) {
        const boundary = await this.osmPlaces.lookupBoundaryById(
          match.osmType,
          match.osmId,
        );
        if (!boundary.value) {
          if (boundary.status === 'failed') {
            return {
              status: 'failed',
              provider: 'nominatim',
              query: hint.name,
              providerResultCount: results.length,
              failureReason:
                boundary.failureReason ?? 'OSM boundary hydration failed',
              failureStage: 'boundary_hydration',
              candidateFoundBeforeFailure: true,
            };
          }
          return {
            status: 'no_candidate',
            provider: 'nominatim',
            query: hint.name,
            providerResultCount: results.length,
            competitorPool,
          };
        }
        if (componentScope.countryBoundedAreaSearch) {
          // ROUTE_LIKE scope hint (§P2-6: a real AREA beyond the destination
          // is admissible). The destination relation is a fact, not a gate;
          // only the coarse-AREA guard applies: an administrative unit
          // coarser than the destination's own is never one Experience's
          // scope (the area-scale rank band above already excludes
          // country/state/region-scale results).
          const adminLevel = Number(boundary.value.tags?.admin_level);
          if (
            isCoarserThanDestination(
              Number.isFinite(adminLevel) ? adminLevel : undefined,
              destinationScope,
            )
          ) {
            return {
              status: 'no_candidate',
              provider: 'nominatim',
              query: hint.name,
              providerResultCount: results.length,
              competitorPool,
              destinationCompatibility: {
                verdict: 'INCOMPATIBLE',
                reason: 'CANDIDATE_COARSER_THAN_DESTINATION',
              },
            };
          }
        } else {
          // Single destination policy: an AREA outside the resolved
          // destination (e.g. "San Martín" -> Partido de General San Martín
          // for a Buenos Aires walk) is never a component of a
          // destination-scoped candidate; UNKNOWN never counts as inside. A
          // member AREA of a candidate-owned (DESCRIPTIVE) AREA is admitted
          // inside that AREA or, like any member, inside the destination.
          const destinationCompatibility = this.areaDestinationCompatibility(
            boundary.value,
            destinationScope,
            {
              latitude: match.latitude as number,
              longitude: match.longitude as number,
            },
          );
          const ownedAreaAdmitted =
            componentScope.scope?.provenance === 'CANDIDATE_AREA'
              ? admitComponentLocation(
                  componentScope.scope,
                  {
                    latitude: match.latitude as number,
                    longitude: match.longitude as number,
                  },
                  destinationScope,
                ).admitted
              : undefined;
          if (ownedAreaAdmitted === false) {
            return {
              status: 'no_candidate',
              provider: 'nominatim',
              query: hint.name,
              providerResultCount: results.length,
              competitorPool,
              outsideExperienceScope: true,
            };
          }
          if (
            ownedAreaAdmitted !== true &&
            destinationCompatibility.verdict !== 'COMPATIBLE'
          ) {
            return {
              status: 'no_candidate',
              provider: 'nominatim',
              query: hint.name,
              providerResultCount: results.length,
              competitorPool,
              destinationCompatibility,
            };
          }
        }
        const correctedHint =
          hint.expectedKind === 'AREA'
            ? hint
            : { ...hint, role: 'area' as const, expectedKind: 'AREA' as const };
        // Pass through the identity multiplicity established from the
        // Nominatim exact-match count; hydrating the boundary does not
        // change the identity multiplicity of the original candidate set.
        return {
          status: 'candidate',
          provider: 'nominatim',
          query: hint.name,
          providerResultCount: results.length,
          competitorPool,
          candidate: this.buildOsmCandidate(correctedHint, boundary.value, {
            exactName: nameMultiplicity.exactName,
            declaredAlias: 'UNKNOWN',
          }),
        };
      }

      if (!isPlaceScaleEligible(match)) {
        return {
          status: 'no_candidate',
          provider: 'nominatim',
          query: hint.name,
          providerResultCount: results.length,
          competitorPool,
        };
      }

      // The scope that will judge this component admits the match, exactly
      // as in the PLACES strategy: a candidate-owned AREA by polygon
      // membership, otherwise the single destination policy (a same-name
      // gallery in another partido is never a component). UNKNOWN (no
      // destination polygon) excludes nothing -- the country code + soft
      // bias remain the only geographic constraint, as before.
      // §P2-18: this query carried the destination country code (enforced
      // by the provider), so for a candidate that may extend beyond the
      // destination a country-bounded match is admissible; identity is
      // still decided by IdentityVerifier over the same result set.
      const admission = componentScope.scope
        ? admitComponentLocation(
            componentScope.scope,
            {
              latitude: match.latitude as number,
              longitude: match.longitude as number,
            },
            destinationScope,
            {
              countryBounded:
                componentScope.admitsCountryBoundedBeyondDestination &&
                Boolean(destinationCountryCode),
            },
          )
        : { admitted: true };
      if (!admission.admitted) {
        return {
          status: 'no_candidate',
          provider: 'nominatim',
          query: hint.name,
          providerResultCount: results.length,
          competitorPool,
          ...(admission.reason === 'DESTINATION_INCOMPATIBLE'
            ? { destinationCompatibility: admission.destinationCompatibility! }
            : { outsideExperienceScope: true as const }),
        };
      }

      const correctedHint =
        hint.expectedKind === 'PLACE'
          ? hint
          : { ...hint, role: 'venue' as const, expectedKind: 'PLACE' as const };

      const externalId = `osm:${match.osmType}:${match.osmId}`;
      const canonicalName =
        match.displayName.split(',')[0]?.trim() || correctedHint.name;
      const geometry = {
        type: 'Point' as const,
        coordinates: [match.longitude as number, match.latitude as number],
      };
      return {
        status: 'candidate',
        provider: 'nominatim',
        query: hint.name,
        providerResultCount: results.length,
        competitorPool,
        candidate: {
          hintKey: correctedHint.key,
          hintName: correctedHint.name,
          // Nominatim is the acquisition strategy (the attempt's `provider`
          // above); the identity itself is an OpenStreetMap object, in the
          // same namespace LOCAL_OSM_POOL, targeted ROUTE and Geoapify Place
          // Details use -- so one real OSM node is one strong identity
          // whichever strategy surfaced it.
          provider: 'openstreetmap',
          externalId,
          canonicalName,
          kind: GeoEntityKind.PLACE,
          latitude: match.latitude,
          longitude: match.longitude,
          geometry,
          role: correctedHint.role,
          nameEvidenceMultiplicity: nameMultiplicity,
          structuralKind: structuralKindFromNominatim(match),
          evidenceOrigins: [
            { authority: 'openstreetmap', recordId: externalId },
          ],
          ...(contextualPool ? { contextualPool } : {}),
          adminContext: {
            country: match.address?.country,
            region: match.address?.state,
            locality:
              match.address?.city ??
              match.address?.town ??
              match.address?.village ??
              match.address?.municipality,
            municipality: match.address?.municipality,
          },
          persistenceMetadata: {
            displayName: match.displayName,
            addresstype: match.addresstype,
            address: match.address,
          },
        },
      };
    } catch (error: any) {
      this.logger.warn(
        `Global trusted resolution failed for "${hint.name}": ${error?.message ?? error}`,
      );
      return {
        status: 'failed',
        provider: 'nominatim',
        query: hint.name,
        failureReason: error?.message ?? String(error),
      };
    }
  }

  /**
   * Stage 3 (component-resolution-and-partial-composite-recovery-plan.md,
   * "Catalog-first identity resolution"): bounded read-side reuse of
   * already-canonical GeoEntity knowledge, tried before any external
   * identity acquisition for this hint.
   *
   * Ownership stays split: `ExperienceCatalogService
   * .findGeoEntityCandidatesForHint` performs only a bounded, kind-filtered,
   * strictly-name-matched read and returns candidates/facts -- it never
   * picks a winner. This method turns that candidate list into the typed
   * acquisition-result shape `resolveCandidate` already understands:
   *
   *  - 0 candidates -> `no_candidate` (a genuine catalog miss; the caller
   *    falls through to the unchanged external pipeline unchanged);
   *  - 1 candidate -> `candidate`, carrying an `EntityCandidate` built from
   *    the GeoEntity's own canonical facts plus one deterministically
   *    chosen persisted `GeoEntityIdentity` (oldest first) as provenance --
   *    `EntityCandidate` itself never carries a canonical id before
   *    verification, so `geoEntityId` travels alongside it on this result
   *    instead, reused directly by the caller only after IdentityVerifier
   *    accepts it (see `reuseCatalogGeoEntity`);
   *  - 2+ candidates -> `ambiguous`; the caller must not arbitrarily pick a
   *    winner and falls through to the external pipeline exactly like a
   *    miss (candidate correlation across catalog rows is explicitly
   *    out of scope for this checkpoint).
   *
   * A GeoEntity with no persisted `GeoEntityIdentity` at all has no
   * deterministic provenance to build an `EntityCandidate` from, so it is
   * treated as `no_candidate` (fail closed) rather than fabricating one.
   */
  private async resolveViaCatalog(
    hint: any,
    placeWindow: ScopeSearchWindow | undefined,
    destinationWindow: ScopeSearchWindow | undefined,
    destinationScope: GeographicScope,
  ): Promise<CatalogAcquisitionResult> {
    const isRoute = hint.expectedKind === 'ROUTE';
    // ROUTE: the same bounded retrieval variants the targeted acquisition
    // uses ("Defensa Street" -> "Defensa"), each an EXACT normalized-name
    // lookup over the DESTINATION scope (a street is not contained by a
    // neighborhood anchor). Never fuzzy, never an alias table.
    const lookups = isRoute
      ? routeRetrievalQueryVariants(hint.name)
      : [{ variant: 'RAW' as const, name: hint.name }];
    // PLACE/AREA lookups use the candidate's scope window (or the work-unit
    // entity-resolution pool scope); a street is not contained by a
    // neighborhood anchor, so ROUTE knowledge is looked up over the
    // destination.
    const lookupWindow = isRoute ? destinationWindow : placeWindow;
    if (!lookupWindow) {
      return { status: 'no_candidate', provider: 'catalog', query: hint.name };
    }

    const byId = new Map<
      string,
      {
        match: CatalogGeoEntityCandidate;
        variant: RouteRetrievalVariantKind;
        lookupName: string;
      }
    >();
    for (const lookup of lookups) {
      const { candidates } = await this.catalog.findGeoEntityCandidatesForHint({
        hintName: lookup.name,
        // GeoEntityHint.expectedKind is exactly 'PLACE' | 'AREA' | 'ROUTE',
        // the same literal union GeoEntityKind is defined over.
        expectedKind: hint.expectedKind as GeoEntityKind,
        window: lookupWindow,
      });
      for (const match of candidates) {
        if (!byId.has(match.geoEntityId)) {
          byId.set(match.geoEntityId, {
            match,
            variant: lookup.variant,
            lookupName: lookup.name,
          });
        }
      }
    }

    let found = [...byId.values()];
    if (isRoute || hint.expectedKind === 'AREA') {
      // Canonical AREA/ROUTE knowledge is reusable only inside THIS
      // destination; UNKNOWN is never treated as compatible.
      const verdicts = found.map((entry) =>
        this.catalogDestinationCompatibility(entry.match, destinationScope),
      );
      if (verdicts.some((v) => v.verdict === 'UNKNOWN')) {
        return {
          status: 'ambiguous',
          provider: 'catalog',
          query: hint.name,
          poolCandidateCount: found.length,
        };
      }
      found = found.filter((_, i) => verdicts[i].verdict === 'COMPATIBLE');
    }

    if (found.length === 0) {
      return { status: 'no_candidate', provider: 'catalog', query: hint.name };
    }
    if (found.length > 1) {
      return {
        status: 'ambiguous',
        provider: 'catalog',
        query: hint.name,
        poolCandidateCount: found.length,
      };
    }

    const [{ match, variant, lookupName }] = found;
    const identity = match.identities[0];
    if (!identity) {
      return { status: 'no_candidate', provider: 'catalog', query: hint.name };
    }

    const entityCandidate: EntityCandidate = {
      hintKey: hint.key,
      hintName: hint.name,
      provider: identity.provider,
      externalId: identity.externalId,
      canonicalName: match.name,
      kind: match.kind,
      latitude: match.latitude,
      longitude: match.longitude,
      geometry: match.geometry,
      role: hint.role,
      expectedType: hint.expectedKind,
      // Every persisted strong identity of the canonical entity, so a later
      // strategy's acquisition of any of them correlates with it.
      identities: match.identities.map(({ provider, externalId }) => ({
        provider,
        externalId,
      })),
      // Strict normalized-name equality already established exactly one
      // compatible catalog candidate -- SINGLE, the same signal
      // `buildLocalIdentityEvidence` turns into EXACT_NAME/SINGLE, which
      // IdentityVerifier treats as immediately VERIFIED with no further
      // (network) corroboration needed. A verified-hint match says nothing
      // about canonical-name multiplicity: UNKNOWN, and its own typed
      // evidence below carries the catalog multiplicity instead.
      nameEvidenceMultiplicity: {
        exactName: match.matchKind === 'CANONICAL_NAME' ? 'SINGLE' : 'UNKNOWN',
        declaredAlias: 'UNKNOWN',
      },
    };

    // The single in-scope match came from verified hint memory (the hint
    // text was remembered on this GeoEntity after an earlier VERIFIED
    // resolution), or through a ROUTE retrieval variant, or by canonical
    // name (EXACT_NAME is derived locally by `buildLocalIdentityEvidence`).
    const evidence: IdentityEvidence[] =
      match.matchKind === 'VERIFIED_HINT'
        ? [
            {
              type: 'CATALOG_VERIFIED_HINT_MATCH',
              verifiedHintKey: normalizeGeoName(lookupName),
              identityMultiplicity: 'SINGLE',
            },
          ]
        : variant === 'DESIGNATOR_NORMALIZED'
          ? [
              {
                type: 'CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH',
                retrievalVariant: variant,
                identityMultiplicity: 'SINGLE',
              },
            ]
          : [];

    return {
      status: 'candidate',
      provider: 'catalog',
      query: hint.name,
      candidate: entityCandidate,
      geoEntityId: match.geoEntityId,
      evidence,
    };
  }

  /**
   * A catalog AREA/ROUTE row against the single destination policy: its
   * representative point plus, for a line geometry, one real vertex per
   * persisted line (a route may extend past the destination limit).
   */
  private catalogDestinationCompatibility(
    match: CatalogGeoEntityCandidate,
    destinationScope: GeographicScope,
  ): DestinationCompatibility {
    const probes: Coordinates[] = [];
    if (Number.isFinite(match.latitude) && Number.isFinite(match.longitude)) {
      probes.push({
        latitude: match.latitude as number,
        longitude: match.longitude as number,
      });
    }
    const geometry = match.geometry as {
      type?: string;
      coordinates?: unknown;
    } | null;
    const lines =
      geometry?.type === 'MultiLineString'
        ? (geometry.coordinates as [number, number][][])
        : geometry?.type === 'LineString'
          ? [geometry.coordinates as [number, number][]]
          : [];
    for (const line of lines) {
      const middle = line[Math.floor(line.length / 2)];
      if (middle) probes.push({ latitude: middle[1], longitude: middle[0] });
    }
    return evaluateDestinationCompatibility(
      { probePoints: probes },
      destinationScope,
    );
  }

  private async resolveViaTrustedObservation(
    hint: any,
    observations: SourceObservation[],
    poolBoundary: OsmCandidate | undefined,
  ): Promise<StrategyAcquisitionResult> {
    if (
      hint.role === 'area' ||
      hint.role === 'route' ||
      hint.expectedKind === 'AREA' ||
      hint.expectedKind === 'ROUTE'
    ) {
      return { status: 'not_applicable' };
    }
    if (!this.placesApi) return { status: 'not_applicable' };

    const eligibleObservations = observations.filter(
      (observation) =>
        observation.evidenceType === 'place' &&
        Boolean(observation.externalId) &&
        acquisitionLabelToPlacesProvider(observation.provider) !== undefined,
    );
    const correlation = findReusableObservationCandidate(
      hint,
      eligibleObservations,
    );
    if (correlation.status !== 'unique') {
      this.logger.debug(
        `[P2-B] reuse ${correlation.status} for hint "${hint.name}"`,
      );
      return {
        status: 'no_candidate',
        provider: 'trusted_observation',
        query: hint.name,
      };
    }
    const observation = correlation.observation;

    // Geographic scope is a PLAUSIBILITY filter, not identity proof -- two
    // genuinely distinct real places can share an identical name and both
    // sit inside the same destination boundary, so this check alone never
    // establishes that the correlated observation IS the entity the hint
    // meant (that is `IdentityVerifier`'s job, below, unchanged). What this
    // check actually rules out is name correlation alone concluding
    // applicability with zero geographic evidence at all -- an observation
    // whose own geo sits outside the destination isn't even a plausible
    // candidate for it, regardless of how well its name correlated. Phase
    // 1 only supports an AREA_BOUNDARY polygon scope; anything else (no
    // boundary geometry, or the observation carries no geo) fails closed
    // rather than guessing via an un-implemented radius check.
    if (
      !poolBoundary?.geometry ||
      !Number.isFinite(observation.geo?.latitude) ||
      !Number.isFinite(observation.geo?.longitude) ||
      !geometryContainsPoint(
        poolBoundary.geometry,
        observation.geo!.longitude as number,
        observation.geo!.latitude as number,
      )
    ) {
      this.logger.debug(
        `[P2-B] reuse candidate outside destination scope for hint "${hint.name}"`,
      );
      return {
        status: 'no_candidate',
        provider: 'trusted_observation',
        query: hint.name,
      };
    }

    // Provider guard -- an externalId is only ever meaningful to the SAME
    // Places backend that emitted it.
    const requiredPlacesProvider = acquisitionLabelToPlacesProvider(
      observation.provider,
    );
    if (requiredPlacesProvider !== this.placesApi.provider) {
      this.logger.debug(
        `[P2-B] reuse provider mismatch (observation=${observation.provider}, active=${this.placesApi.provider}) for hint "${hint.name}"`,
      );
      return {
        status: 'no_candidate',
        provider: placesAcquisitionLabel(this.placesApi.provider),
        query: hint.name,
      };
    }

    // Deterministic provider fetch establishes what this observation
    // actually identifies RIGHT NOW -- the observation's own title/geo are
    // never trusted as final. Phase 1's only additional fact requested
    // beyond the pre-existing minimal field mask is `businessStatus`
    // (same billing tier `searchText` already uses) -- see
    // `GooglePlacesApiService.getPlaceDetails`. Coordinates still come
    // from the observation itself (already real, from the original
    // acquisition search); Phase 1 deliberately does not request
    // `location` here to avoid an unnecessary field-mask change.
    let details: Partial<PlaceData> | undefined;
    try {
      const result = await this.placesApi.getPlaceDetails(
        observation.externalId as string,
      );
      details = result.data;
    } catch (error: any) {
      this.logger.debug(
        `[P2-B] reuse getPlaceDetails failed for hint "${hint.name}": ${error?.message ?? error}`,
      );
      return {
        status: 'failed',
        provider: placesAcquisitionLabel(this.placesApi.provider),
        query: hint.name,
        failureReason: error?.message ?? String(error),
      };
    }
    if (!details) {
      return {
        status: 'failed',
        provider: placesAcquisitionLabel(this.placesApi.provider),
        query: hint.name,
        failureReason: 'PLACE_DETAILS_EMPTY',
      };
    }
    if (details.businessStatus === 'CLOSED_PERMANENTLY') {
      this.logger.debug(
        `[P2-B] reuse candidate closed permanently for hint "${hint.name}"`,
      );
      return {
        status: 'no_candidate',
        provider: placesAcquisitionLabel(this.placesApi.provider),
        query: hint.name,
      };
    }

    const canonicalName =
      details.displayName?.text || details.name || observation.title;
    const latitude = observation.geo!.latitude as number;
    const longitude = observation.geo!.longitude as number;
    const providerLabel = placesAcquisitionLabel(this.placesApi.provider);
    const externalId = canonicalPlacesExternalId(
      this.placesApi.provider,
      observation.externalId as string,
    );
    const geometry = {
      type: 'Point' as const,
      coordinates: [longitude, latitude],
    };
    // The same details response may declare explicit cross-identities
    // (Geoapify: OSM object + Wikidata QID) -- kept as correlation facts,
    // never parsed out of the opaque id.
    const sourceIdentities = (details.sourceIdentities ?? []).map(
      ({ provider, externalId: id }) => ({ provider, externalId: id }),
    );
    const wikidataQid = sourceIdentities.find(
      (identity) => identity.provider === 'wikidata',
    )?.externalId;
    this.logger.debug(
      `[P2-B] reuse candidate acquired for hint "${hint.name}" via ${externalId}`,
    );

    return {
      status: 'candidate',
      provider: providerLabel,
      query: hint.name,
      candidate: {
        hintKey: hint.key,
        hintName: hint.name,
        provider: providerLabel,
        externalId,
        canonicalName,
        kind: GeoEntityKind.PLACE,
        latitude,
        longitude,
        geometry,
        role: hint.role,
        // One acquisition-run observation identifies the fetched provider
        // record, but never proves real-world uniqueness. Use UNKNOWN so
        // IdentityVerifier requires independent corroboration.
        nameEvidenceMultiplicity: {
          exactName: 'UNKNOWN',
          declaredAlias: 'UNKNOWN',
        },
        ...this.placesEvidenceOrigins(
          providerLabel,
          externalId,
          sourceIdentities,
        ),
        ...(wikidataQid ? { wikidataQid } : {}),
        ...(sourceIdentities.length > 0
          ? {
              identities: [
                { provider: providerLabel, externalId },
                ...sourceIdentities,
              ],
            }
          : {}),
        persistenceMetadata: { formattedAddress: details.formattedAddress },
      },
    };
  }

  /**
   * Fallback for a PLACE hint Nominatim/OSM couldn't resolve. Uses whichever
   * IPlacesApiService the PLACES_PROVIDER env var selects (Google or
   * Geoapify — see integrations.module.ts's createRealPlacesApiService), the
   * same caching-wrapped instance the catalog-refill path already uses, so
   * this consumes the exact same quota/cache as the rest of the app rather
   * than a second, separately-configured client.
   *
   * Stage 3 PLACE cutover order, each step owning one question:
   *  1. text search with the hint text unchanged (no alias, no stripping);
   *  2. structural compatibility -- can this KIND of object be a PLACE?
   *     (provider-declared `featureClass`; streets, administrative areas,
   *     postcodes and transit stops never are);
   *  3. destination scope -- the single destination policy drops objects
   *     positively outside the resolved destination (a same-name gallery in
   *     another partido); UNKNOWN scope drops nothing, keeping the hard
   *     search circle as the only geographic constraint as before;
   *  4. bounded selection among the survivors (`selectBestPlaceCandidate`,
   *     ranking only) and name multiplicity over the SAME survivors;
   *  5. Place Details for the ONE selected candidate, only when the
   *     provider can declare cross-identities, turning an opaque handle into
   *     explicit OSM/Wikidata identities for correlation.
   * Identity itself stays with strong-identity correlation +
   * IdentityVerifier; nothing here authorizes a match.
   */
  private async resolveViaPlaces(
    hint: any,
    destinationScope: GeographicScope,
    componentScope: ComponentAcquisitionScope,
    context: ComponentIdentityContext = {},
  ): Promise<StrategyAcquisitionResult> {
    if (!this.placesApi || hint.expectedKind !== 'PLACE') {
      return { status: 'not_applicable' };
    }

    const providerLabel = placesAcquisitionLabel(this.placesApi.provider);
    // Identity-search geography is the scope that will judge the component
    // (spec 2026-10-02 Part II §P2-10): a verified candidate-owned AREA /
    // ROUTE, else the destination — its bounding-box covering window, never
    // a plausibility constant. Whether the provider honors it as a bias or
    // a restriction, and any per-request radius cap, stays in the adapter.
    const window = componentScope.window;
    try {
      const result = await this.placesApi.searchText({
        textQuery: hint.name,
        maxResultCount: PLACES_TEXT_SEARCH_RESULT_WINDOW,
        locationBias: window
          ? { center: window.center, radius: window.radiusMeters }
          : undefined,
      });
      const placeSearch: PlaceSearchAudit = {
        resultCount: result.data.length,
        rejected: [],
        viableCount: 0,
        ...(window
          ? {
              searchWindow: {
                provenance: window.provenance,
                radiusMeters: window.radiusMeters,
              },
            }
          : {}),
      };
      const viable: PlaceData[] = [];
      for (const place of result.data) {
        const name = place.displayName?.text || place.name || '';
        if (
          evaluateStructuralCompatibility(
            'PLACE',
            structuralKindFromPlaceFeatureClass(place.featureClass),
          ) === 'INCOMPATIBLE'
        ) {
          placeSearch.rejected.push({
            name,
            reason: 'STRUCTURALLY_INCOMPATIBLE',
            featureClass: place.featureClass!,
          });
          continue;
        }
        const admission = componentScope.scope
          ? admitComponentLocation(
              componentScope.scope,
              place.location,
              destinationScope,
            )
          : { admitted: true };
        if (!admission.admitted) {
          placeSearch.rejected.push(
            admission.reason === 'DESTINATION_INCOMPATIBLE'
              ? {
                  name,
                  reason: 'DESTINATION_INCOMPATIBLE',
                  destinationReason: admission.destinationCompatibility!.reason,
                }
              : { name, reason: 'OUTSIDE_EXPERIENCE_SCOPE' },
          );
          continue;
        }
        viable.push(place);
      }
      placeSearch.viableCount = viable.length;

      const place = selectBestPlaceCandidate(hint.name, viable, window?.center);
      // A circle around a destination-bounded scope covers that scope; an
      // answer filling the requested window may have been cut off.
      const coverage: CompetitorPoolCoverage =
        window && result.data.length < PLACES_TEXT_SEARCH_RESULT_WINDOW
          ? this.destinationPoolCoverage(componentScope)
          : 'PARTIAL';
      const exactNameCount = countExactNormalizedMatches(
        hint.name,
        viable,
        (candidate) => candidate.displayName?.text || candidate.name,
      );
      const nameMultiplicity = {
        exactName: poolMultiplicity(exactNameCount, coverage),
        declaredAlias: 'UNKNOWN' as const,
      };
      // Every structurally possible record is a potential competitor,
      // whatever its admission (the examination applies the component's
      // admission itself). Only the selected record carries the
      // cross-identities its Place Details declared.
      const placesCompetitorPool = (selected?: {
        id: string;
        identities: StrongIdentity[];
      }): CompetitorPool => ({
        strategy: 'PLACES',
        coverage,
        // Structural compatibility of each member is judged by
        // `examineCompetitors`, the same way for every provider's pool.
        members: result.data.map(
          (candidate): CompetitorPoolMember => ({
            identityKeys: [
              strongIdentityKey({
                provider: providerLabel,
                externalId: canonicalPlacesExternalId(
                  this.placesApi!.provider,
                  candidate.id,
                ),
              }),
              ...(selected?.id === candidate.id
                ? selected.identities.map(strongIdentityKey)
                : []),
            ],
            name: candidate.displayName?.text || candidate.name || '',
            ...(candidate.location &&
            Number.isFinite(candidate.location.latitude) &&
            Number.isFinite(candidate.location.longitude)
              ? {
                  latitude: candidate.location.latitude,
                  longitude: candidate.location.longitude,
                }
              : {}),
            structuralKind: structuralKindFromPlaceFeatureClass(
              candidate.featureClass,
            ),
          }),
        ),
      });
      // Every exact-name result is a potential competitor, whatever its
      // admission. The provider search is a hard circle around the scope
      // window, so it is never a complete comparison for a source locality:
      // it can expose an equally consistent competitor (AMBIGUOUS) but can
      // never single one out.
      const placeName = (candidate: PlaceData) =>
        candidate.displayName?.text || candidate.name || '';
      const contextualPool = evaluateContextualPool(
        context,
        result.data
          .filter(
            (candidate) =>
              normalizeGeoName(placeName(candidate)) ===
              normalizeGeoName(hint.name),
          )
          .map(
            (candidate): ContextualPoolMember => ({
              identityKey: candidateIdentityKey({
                provider: providerLabel,
                externalId: canonicalPlacesExternalId(
                  this.placesApi!.provider,
                  candidate.id,
                ),
              }),
              latitude: candidate.location?.latitude,
              longitude: candidate.location?.longitude,
              structuralKind: structuralKindFromPlaceFeatureClass(
                candidate.featureClass,
              ),
            }),
          ),
        'NOT_ESTABLISHED',
      );
      if (
        !place?.location ||
        !Number.isFinite(place.location.latitude) ||
        !Number.isFinite(place.location.longitude)
      ) {
        return {
          status: 'no_candidate',
          provider: providerLabel,
          query: hint.name,
          providerResultCount: result.data.length,
          placeSearch,
          competitorPool: placesCompetitorPool(),
        };
      }

      const canonicalName = place.displayName?.text || place.name || hint.name;
      const externalId = canonicalPlacesExternalId(
        this.placesApi.provider,
        place.id,
      );
      const sourceIdentities = await this.enrichPlaceIdentities(
        place.id,
        placeSearch,
      );
      const wikidataQid = sourceIdentities.find(
        (identity) => identity.provider === 'wikidata',
      )?.externalId;
      const geometry = {
        type: 'Point' as const,
        coordinates: [place.location.longitude, place.location.latitude],
      };
      return {
        status: 'candidate',
        provider: providerLabel,
        query: hint.name,
        providerResultCount: result.data.length,
        placeSearch,
        competitorPool: placesCompetitorPool({
          id: place.id,
          identities: sourceIdentities,
        }),
        candidate: {
          hintKey: hint.key,
          hintName: hint.name,
          provider: providerLabel,
          externalId,
          canonicalName,
          kind: GeoEntityKind.PLACE,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
          geometry,
          role: hint.role,
          nameEvidenceMultiplicity: nameMultiplicity,
          structuralKind: structuralKindFromPlaceFeatureClass(
            place.featureClass,
          ),
          ...this.placesEvidenceOrigins(
            providerLabel,
            externalId,
            sourceIdentities,
          ),
          ...(contextualPool ? { contextualPool } : {}),
          ...(wikidataQid ? { wikidataQid } : {}),
          ...(sourceIdentities.length > 0
            ? {
                identities: [
                  { provider: providerLabel, externalId },
                  ...sourceIdentities,
                ],
              }
            : {}),
          persistenceMetadata: {
            formattedAddress: place.formattedAddress,
            types: place.types,
          },
        },
      };
    } catch (error: any) {
      this.logger.warn(
        `Places fallback resolution failed for "${hint.name}": ${error?.message ?? error}`,
      );
      return {
        status: 'failed',
        provider: providerLabel,
        query: hint.name,
        failureReason: error?.message ?? String(error),
      };
    }
  }

  /**
   * Evidence origins of a Places record. A provider that declares its
   * records' sources (Place Details) derives this record from the declared
   * non-Wikidata identities (a QID is a cross-reference, not a source); a
   * provider without that capability authored the record itself. A
   * declaring provider that declared nothing leaves the origin
   * undetermined.
   */
  private placesEvidenceOrigins(
    providerLabel: string,
    externalId: string,
    sourceIdentities: ReadonlyArray<StrongIdentity>,
  ): { evidenceOrigins?: EvidenceOrigin[] } {
    if (!this.placesApi?.declaresSourceIdentitiesInDetails) {
      return {
        evidenceOrigins: [{ authority: providerLabel, recordId: externalId }],
      };
    }
    const origins = sourceIdentities
      .filter((identity) => identity.provider !== 'wikidata')
      .map((identity) => ({
        authority: identity.provider,
        recordId: identity.externalId,
      }));
    return origins.length > 0 ? { evidenceOrigins: origins } : {};
  }

  /**
   * Explicit cross-identities (OSM object, Wikidata QID) the Places provider
   * declares for ONE already-selected record via Place Details. Only called
   * when the provider has that capability; enrichment is additive, so a
   * failed/empty details call leaves the candidate with its own handle and
   * is recorded, never turned into an acquisition failure or contradiction.
   */
  private async enrichPlaceIdentities(
    placeId: string,
    placeSearch: PlaceSearchAudit,
  ): Promise<Array<{ provider: string; externalId: string }>> {
    if (!this.placesApi?.declaresSourceIdentitiesInDetails) {
      placeSearch.identityEnrichment = { status: 'NOT_SUPPORTED' };
      return [];
    }
    try {
      const details = await this.placesApi.getPlaceDetails(placeId);
      const identities = (details.data?.sourceIdentities ?? []).map(
        ({ provider, externalId }) => ({ provider, externalId }),
      );
      placeSearch.identityEnrichment =
        identities.length > 0
          ? { status: 'ENRICHED', identities }
          : { status: 'NO_SOURCE_IDENTITIES' };
      return identities;
    } catch (error: any) {
      const failureReason = error?.message ?? String(error);
      this.logger.warn(
        `Place Details identity enrichment failed for ${placeId}: ${failureReason}`,
      );
      placeSearch.identityEnrichment = { status: 'FAILED', failureReason };
      return [];
    }
  }

  private hasDestinationAssociationEvidence(
    candidate: any,
    destinationName: string | undefined,
    evidence: ExperienceResolutionRequest['evidence'],
  ): boolean {
    if (!destinationName || !candidate?.evidenceKeys?.length) return false;
    const destinationTokens = normalizeGeoName(destinationName)
      .split(' ')
      .filter((token) => token.length >= 4);
    if (destinationTokens.length === 0) return false;

    const candidateEvidence = (evidence ?? []).filter((item) =>
      candidate.evidenceKeys.includes(item.key ?? ''),
    );
    return candidateEvidence.some((item) => {
      const text = normalizeGeoName(
        `${item.title ?? ''} ${item.snippet ?? ''}`,
      );
      return destinationTokens.some((token) => text.includes(token));
    });
  }

  /**
   * Two different componentHints of the *same* candidate can resolve onto
   * the *same* real GeoEntity — verified live: ExperienceCatalogService's own
   * cross-provider reconciliation (added earlier this recovery, so the same
   * real place stops minting duplicate GeoEntity rows across *different*
   * candidates/generations) makes this more likely, not less, since two
   * hints in one candidate that name near-identical/overlapping real places
   * now correctly land on one entity instead of two separate ones. Without
   * this, `persistVerifiedExperience`'s nested `components: { create: [...] }`
   * would insert the same (experienceId, geoEntityId) pair twice, crashing
   * on ExperienceComponent's own unique constraint — reproduced live: a
   * Recoleta candidate's "area" and "venue" hints reconciled onto one
   * GeoEntity, aborting the whole generation. Keeps the first occurrence
   * (preserves array order for `orderedByEvidence`'s sequential numbering).
   */
  /**
   * Batch-collects real Wikidata sitelink counts for every distinct
   * VERIFIED resolved component across the given (already
   * geographically-accepted) candidates -- ONE `getEntitySummaries` call
   * for the whole set, never per-component/per-candidate (B3 amendment,
   * component-quality wiring). Only a `ResolvedGeoEntity` with
   * `status === 'resolved'`, a persisted `geoEntityId`, and its own
   * `wikidataQid` (identity already confirmed by `IdentityVerifier` along
   * the normal resolution path) contributes a QID -- never an unresolved
   * hint, a nearby-proximity guess, or an unconfirmed match.
   *
   * Fails open: no Wikidata client, zero QIDs, or a provider failure all
   * degrade to an empty map. A QID absent from the returned map is UNKNOWN
   * to the caller, never a fabricated 0 -- `computeQualityScore`'s
   * `componentNotabilitySignals` only ever receives counts this method
   * actually found.
   */
  private async fetchComponentNotabilityByQid(
    candidates: ResolvedExperienceCandidate[],
  ): Promise<Map<string, number>> {
    if (!this.wikidata) return new Map();

    const qids = new Set<string>();
    for (const candidate of candidates) {
      for (const entity of candidate.resolvedEntities) {
        if (
          entity.status === 'resolved' &&
          entity.geoEntityId &&
          entity.wikidataQid
        ) {
          qids.add(entity.wikidataQid);
        }
      }
    }
    if (qids.size === 0) return new Map();

    try {
      const summaries = await this.wikidata.getEntitySummaries([...qids]);
      const notabilityByQid = new Map<string, number>();
      for (const [qid, summary] of summaries) {
        if (
          typeof summary.sitelinkCount === 'number' &&
          Number.isFinite(summary.sitelinkCount) &&
          summary.sitelinkCount >= 0
        ) {
          notabilityByQid.set(qid, summary.sitelinkCount);
        }
      }
      return notabilityByQid;
    } catch (error: any) {
      this.logger.warn(
        `Component notability lookup failed (${qids.size} QID(s)): ${error?.message ?? error}`,
      );
      return new Map();
    }
  }

  /**
   * One persisted component per canonical GeoEntity: two source hints that
   * converge on the same physical object are one ExperienceComponent
   * (existing canonical policy). Membership comes from the complete source
   * composition, never from a per-component flag.
   */
  private dedupeResolvedEntitiesByGeoEntity<
    T extends { geoEntityId?: string; hintKey?: string },
  >(entities: T[]): T[] {
    const seen = new Set<string>();
    return entities.filter((entity) => {
      if (!entity.geoEntityId || seen.has(entity.geoEntityId)) return false;
      seen.add(entity.geoEntityId);
      return true;
    });
  }

  private representativePoint(
    candidate: OsmCandidate | undefined,
  ): { latitude: number; longitude: number } | undefined {
    // Missing boundary/geometry is an unresolved geographic fact. Do not
    // fabricate a point or let a provider coverage gap crash the whole
    // acquisition pass; callers already treat an absent point as an
    // unanchored global-resolution attempt.
    if (!candidate?.geometry) return undefined;

    const geometry = candidate.geometry;
    if (geometry.type === 'Point') {
      return {
        latitude: geometry.coordinates[1],
        longitude: geometry.coordinates[0],
      };
    }

    const coordinates: Array<[number, number]> =
      geometry.type === 'LineString'
        ? geometry.coordinates
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
}
