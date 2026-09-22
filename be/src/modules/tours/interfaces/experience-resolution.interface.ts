import { GeoEntityKind } from '@prisma/client';
import { ExperienceCandidate } from './experience-discovery.interface';
import { DedupeEvidence } from '../utils/experience-dedupe.util';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { AreaScopeMembershipAudit } from './area-scope-membership.interface';
import { SourceObservation } from './experience-acquisition.interface';
import { GeographicValidationDecisionEntity } from './geographic-validation.interface';

/**
 * Task B5 — a request-level, non-authoritative geographic scope resolved
 * BEFORE acquisition even runs (e.g. a real "San Telmo" AREA polygon or a
 * real "Caminito" ROUTE LineString), threaded through to gate persistence
 * regardless of whether the ACQUIRED candidate's own componentHints happen
 * to include a matching AREA/ROUTE hint. `geometry` is required —
 * `AreaRouteAnchorResolverService`'s `resolved: true` contract guarantees
 * it is always populated when a scope is supplied at all; a caller that
 * somehow constructs one without usable geometry gets a conservative
 * rejection (fail closed), never a silently skipped check.
 */
export type ExperienceValidationScope =
  | {
      kind: 'AREA' | 'ROUTE';
      anchorName: string;
      geoEntityId: string;
      geometry: GeoJsonGeometry;
    }
  | {
      kind: 'POINT_RADIUS';
      anchorName: string;
      geometry: GeoJsonGeometry;
    };

/** The request's resolved geographic search scope. A point is never an OSM entity. */
export type GeographicScope =
  | { kind: 'AREA_BOUNDARY'; boundary: OsmCandidate }
  | {
      kind: 'POINT_RADIUS';
      latitude: number;
      longitude: number;
      radiusMeters: number;
    };

export type ResolvedGeoEntityStatus = 'resolved' | 'unresolved';

/**
 * Provider-normalized facts used to decide whether an acquired entity is the
 * hint's real-world identity. Acquisition and ranking may produce these
 * facts, but neither may declare an entity verified.
 */
export type IdentityMultiplicity = 'SINGLE' | 'MULTIPLE' | 'UNKNOWN';

/**
 * Evidence-specific name multiplicities.
 * EXACT_NAME and DECLARED_ALIAS_MATCH can have different multiplicities
 * because they depend on different candidate pools and matching rules.
 */
export interface NameEvidenceMultiplicity {
  exactName: IdentityMultiplicity;
  declaredAlias: IdentityMultiplicity;
}

export type IdentityEvidence =
  | { type: 'EXACT_NAME'; identityMultiplicity: IdentityMultiplicity }
  | { type: 'ADDRESS_MATCH' }
  | { type: 'DECLARED_ALIAS_MATCH'; identityMultiplicity: IdentityMultiplicity }
  | {
      type: 'WIKIDATA_IDENTITY_MATCH';
      source: 'OWN_QID' | 'OBSERVATION_QID' | 'NEARBY';
      hintMatched: boolean;
      candidateMatched: boolean;
    }
  | { type: 'WIKIDATA_UNAVAILABLE' };

export type ResolutionStrategy =
  | 'TRUSTED_OBSERVATION_REUSE'
  | 'LOCAL_OSM_POOL'
  | 'NOMINATIM'
  | 'PLACES'
  | 'AREA_TO_PLACE_CORRECTION'
  | 'ANCHOR_RESOLUTION';

/** A selected candidate plus facts; deliberately not a verification verdict. */
export interface ResolutionAttempt {
  strategy: ResolutionStrategy;
  candidate: EntityCandidate;
  evidence: IdentityEvidence[];
}

export type VerificationDecision =
  | { status: 'VERIFIED' }
  | { status: 'AMBIGUOUS' }
  | { status: 'INSUFFICIENT_EVIDENCE' }
  | { status: 'REJECTED' };

/** The exact evidence and verdict returned by the canonical verification path. */
export interface VerificationResult {
  decision: VerificationDecision;
  evidence: IdentityEvidence[];
}

/** Bounded, provider-neutral forensic facts for one executed strategy. */
export interface ResolutionAttemptAudit {
  strategy: ResolutionStrategy;
  executionStatus: 'completed' | 'failed';
  provider?: string;
  query?: string;
  /** Count returned by the provider search, when the provider exposes it. */
  providerResultCount?: number;
  /** Number of local OSM candidates evaluated by the strategy. */
  poolCandidateCount?: number;
  /** Number of local candidates matching the hint before verification. */
  matchingCandidateCount?: number;
  candidateAcquired: boolean;
  failureReason?: string;
  selectedCandidate?: {
    canonicalName: string;
    externalId: string;
    kind: GeoEntityKind;
  };
  identityEvidence: IdentityEvidence[];
  verificationDecision?: VerificationDecision['status'];
}

export interface ComponentResolutionAudit {
  hintKey: string;
  hintName: string;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedKind?: string;
  required: boolean;
  evidenceKeys: string[];
  addressHint?: string;
  attempts: ResolutionAttemptAudit[];
  finalStatus: ResolvedGeoEntityStatus;
  finalReason?: string;
  resolvedGeoEntity?: Pick<
    ResolvedGeoEntity,
    'geoEntityId' | 'canonicalName' | 'provider' | 'externalId'
  >;
}

export interface CandidateResolutionAudit {
  /** Stable identity generated while the candidate and audit are co-created. */
  candidateTraceKey: string;
  candidateName: string;
  candidateEvidenceKeys: string[];
  candidateHintKeys: string[];
  componentAudits: ComponentResolutionAudit[];
}

/**
 * A normalized provider candidate before canonical persistence. It carries
 * every fact needed to verify identity AND persist the entity — there is
 * exactly one representation of provider, externalId, canonicalName,
 * coordinates, and kind, so verified facts are identical to persisted facts
 * by construction. Never carries a GeoEntity id or resolved status:
 * IdentityVerifier must authorize that transition first.
 */
export interface EntityCandidate {
  hintKey: string;
  hintName: string;
  provider: string;
  externalId: string;
  canonicalName: string;
  kind: GeoEntityKind;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: unknown;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType?: string;
  wikidataQid?: string;
  nameAliasCandidates?: string[];
  addressConfirmed?: boolean;
  nameEvidenceMultiplicity: NameEvidenceMultiplicity;
  adminContext?: {
    country?: string;
    region?: string;
    locality?: string;
    municipality?: string;
  };
  /** Provider-specific metadata carried through to persistence (tags, etc). */
  persistenceMetadata?: unknown;
}

export interface ResolvedGeoEntity {
  hintKey: string;
  hintName: string;
  provider: string;
  externalId?: string;
  /** Present only after the resolver persists a VERIFIED EntityCandidate. */
  geoEntityId?: string;
  canonicalName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geometry?: unknown;
  /**
   * Present only for an OSM-sourced entity whose node/way/relation itself
   * carries a `wikidata=Qxxxx` tag. A direct, provider-declared structural
   * cross-reference — not something derived by name/proximity search — so
   * IdentityVerifier trusts it over the geo-proximity fallback when present.
   */
  wikidataQid?: string;
  /**
   * Present only for an OSM-sourced entity: every other name its own tags
   * declare (`name:xx`, `official_name`, `alt_name`, `short_name`,
   * `loc_name`, plus the title inside a `wikipedia=xx:Title` tag).
   * IdentityVerifier checks these before any network call -- a direct
   * declaration by the same real OSM record, not an independent
   * cross-reference lookup.
   */
  nameAliasCandidates?: string[];
  /**
   * True only when the hint's own `addressHint` (a street address the
   * discovery evidence explicitly gave) matched THIS candidate's own
   * `addr:housenumber`/`addr:street` tags exactly. Computed once at
   * OSM-candidate construction time (both the hint and the raw OSM tags are in
   * scope there); IdentityVerifier trusts this outright, same tier as an
   * exact name match -- an address either matches or it doesn't.
   */
  addressConfirmed?: boolean;
  /**
   * Evidence-specific name multiplicities established at candidate selection time.
   * exactName: SINGLE means the source had exactly one identity-capable exact-name candidate.
   * declaredAlias: SINGLE means the source had exactly one identity-capable alias-matching candidate.
   * MULTIPLE/UNKNOWN have analogous meanings. For raw OSM ROUTE ways, both are UNKNOWN.
   */
  nameEvidenceMultiplicity: NameEvidenceMultiplicity;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedType?: string;
  status: ResolvedGeoEntityStatus;
  reason?: string;
  adminContext?: {
    country?: string;
    region?: string;
    locality?: string;
    municipality?: string;
  };
}

export interface ResolvedExperienceCandidate {
  candidate: ExperienceCandidate;
  status: 'accepted' | 'rejected';
  resolvedEntities: ResolvedGeoEntity[];
  rejectionReasons: string[];
  /**
   * Internal verification signal: referenced grounded evidence explicitly
   * associates this Experience with the requested destination/base. It lets
   * geographic validation verify an Experience's own coherent geography
   * without incorrectly requiring every associated Experience to lie inside
   * the destination polygon.
   */
  destinationAssociationVerified?: boolean;
  experienceId?: string;
  dedupeDecision?: 'SAME' | 'NEW' | 'AMBIGUOUS';
  dedupeEvidence?: DedupeEvidence;
  dedupeCandidates?: string[];
}

export interface ExperienceResolutionRequest {
  candidates: ExperienceCandidate[];
  destinationName?: string;
  /**
   * ISO 3166-1 alpha-2 country code of the resolved destination, when known.
   * Threaded into every Nominatim hint lookup to prevent a generic/common
   * place name from matching a same-named place in an unrelated country —
   * verified live against the real API (see nominatim.interface.ts).
   */
  destinationCountryCode?: string;
  geographicScope?: GeographicScope;
  /**
   * Task A6 (2026-09-17 confirmation-collision-fix plan, Root Cause #4) --
   * when a request is anchored to a specific resolved AREA (e.g. "San
   * Telmo"), this narrows ONLY the local OSM pool fetch entity resolution
   * queries against (lookupStreetsWithin/lookupPoisWithin) -- never
   * geographic validation, which always keeps using `geographicScope`'s
   * full destination boundary regardless of this field. Absent for every
   * caller other than AreaRouteWalkAcquisitionService with a resolved AREA
   * anchor -- falls back to `geographicScope` when omitted, byte-identical
   * to this field never having existed.
   */
  entityResolutionScope?: GeographicScope;
  /**
   * The raw structured acquisition observations behind this request's
   * candidates, when they came from a structured (non-LLM) source
   * (Wikivoyage, Places) via `StructuredExperienceCandidateSynthesizerService`.
   * Sibling of `candidates`, never merged into a `GeoEntityHint` itself --
   * `GeoEntityHint`'s shape is also the LLM discovery extractor's JSON
   * contract, and this data must never be reachable from that path.
   * `IdentityVerifier` looks up a hint's own `canonicalIdentity.wikidataQid`
   * here (by matching `evidenceKeys`) as an independent, provider-sourced
   * identity signal alongside an OSM candidate's own `wikidata` tag --
   * both a real cross-reference to Wikidata, never a guess. Absent for
   * every caller that doesn't pass it, byte-identical to this field never
   * having existed.
   */
  observations?: SourceObservation[];
  traceContext?: Record<string, unknown>;
  evidence?: Array<{
    key?: string;
    source: string;
    url?: string;
    title?: string;
    snippet?: string;
  }>;
  /** Task B5 — see ExperienceValidationScope. Absent for every caller other
   * than AreaRouteWalkAcquisitionService (ordinary generation-loop
   * deficits, acquireNearby) — no behavior change there. */
  validationScope?: ExperienceValidationScope;
  /**
   * Task B5 — the REQUEST's own acquisition intent ('walk'/'route_like'),
   * used ONLY to select a geographic threshold policy (routeScale) inside
   * CompositeGeographicValidationService. Never derived from anything the
   * extractor/candidate claims, never persisted, never used to satisfy
   * candidateMatchesPreferenceFacet, and never treated as Experience
   * semantic truth.
   */
  validationIntent?: 'walk' | 'route_like';
}

export interface ExperienceGeographicValidationResult {
  proposalName: string;
  /** Keep this aligned with the validator boundary. Candidate extraction owns
   * the finite proposal vocabulary; geographic validation reports what it
   * actually evaluated instead of narrowing the runtime result a second time. */
  kind: string;
  status:
    | 'UNVERIFIED'
    | 'GROUNDED'
    | 'GEO_VERIFIED'
    | 'AUTHORITATIVELY_VERIFIED'
    | 'REJECTED';
  accepted: boolean;
  strategy?:
    | 'canonical_entity'
    | 'canonical_area'
    | 'compact_anchors'
    | 'canonical_geometry'
    | 'component_defined'
    | 'venue_centric';
  canonicalEntity?: ResolvedGeoEntity;
  anchors: ResolvedGeoEntity[];
  coherence?: {
    centroid: { latitude: number; longitude: number };
    radiusMeters: number;
    maxPairwiseDistanceMeters: number;
  };
  groundedEvidenceKeys: string[];
  rejectionReasons: string[];
  areaScopeMembership?: AreaScopeMembershipAudit;
  /** Exact entities used by the canonical decision; trace never infers offenders. */
  decisionEntities?: GeographicValidationDecisionEntity[];
  validatorVersion: number;
}

export interface ExperienceGeographicValidationBatchResult {
  results: ExperienceGeographicValidationResult[];
  acceptedCount: number;
  rejectedCount: number;
  resolved?: ResolvedExperienceCandidate[];
}

export interface ExperienceMaterializationResponse {
  resolved: ResolvedExperienceCandidate[];
}

export interface ExperienceEntityResolutionResponse {
  totalCandidates: number;
  acceptedCount: number;
  rejectedCount: number;
  resolved: ResolvedExperienceCandidate[];
  forensicAudit: CandidateResolutionAudit[];
}

/**
 * Shared resolution shape used by intermediate trace/test fixtures. The final
 * V2 resolver result is refined below so geographic validation cannot be
 * omitted from the canonical pipeline.
 */
export interface ExperienceResolutionResponse {
  totalCandidates: number;
  acceptedCount: number;
  rejectedCount: number;
  resolved: ResolvedExperienceCandidate[];
  entityResolution?: ExperienceEntityResolutionResponse;
  geographicValidation?: ExperienceGeographicValidationBatchResult;
  materialization?: ExperienceMaterializationResponse;
  classification?: Array<{
    experienceId: string;
    state: 'classified' | 'degraded' | 'reused';
    provider?: string;
    model?: string;
    promptVersion?: number;
    themes: string[];
    intents: string[];
    traits: string[];
    reasoningEvidence: Array<{
      facet: string;
      evidenceKeys: string[];
      reason: string;
    }>;
  }>;
}

export interface FinalExperienceResolutionResponse
  extends ExperienceResolutionResponse {
  geographicValidation: ExperienceGeographicValidationBatchResult;
  validationScope?: ExperienceValidationScope;
  /**
   * The request's acquisition intent ('walk'/'route_like'), used ONLY to select
   * a geographic threshold policy inside CompositeGeographicValidationService.
   * Never derived from anything the extractor/candidate claims.
   */
  validationIntent?: 'walk' | 'route_like';
  /**
   * Non-geometry summary of the destination boundary used for geographic
   * validation. Populated from the actual runtime value used by the validator.
   * Enables forensic trace to answer "outside which destination boundary?"
   * without storing raw geometry.
   */
  destinationBoundary?: {
    name?: string;
    externalId?: string;
  };
}

export interface ExperienceProposalResolver {
  resolve(
    request: ExperienceResolutionRequest,
  ): Promise<FinalExperienceResolutionResponse>;
}

export const EXPERIENCE_PROPOSAL_RESOLVER = 'EXPERIENCE_PROPOSAL_RESOLVER';
