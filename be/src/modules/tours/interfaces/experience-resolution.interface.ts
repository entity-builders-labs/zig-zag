import { GeoEntityKind } from '@prisma/client';
import {
  ComponentLocalityAssertion,
  ComponentNormalizationKind,
  ComponentPhysicalKind,
  ComponentPhysicalKindAssertion,
  ComponentSourceLink,
  ExperienceCandidate,
  GeoEntityHint,
} from './experience-discovery.interface';
import {
  CandidateStructuralKind,
  ContextualPoolCoverage,
  ContextualPoolEvaluation,
  ContextualPoolOutcome,
} from './component-identity-context.interface';
import { DedupeEvidence } from '../utils/experience-dedupe.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import {
  AreaScopeMembershipAudit,
  ComponentAreaRelation,
  ComponentGeometryBasis,
} from './area-scope-membership.interface';
import { RouteScopeMembershipAudit } from './route-scope-membership.interface';
import {
  ExperienceDestinationRelation,
  ExperienceGeographicScopeProjection,
  ExperienceGeographicScopeProvenance,
  WorkUnitAnchorScope,
} from './experience-geographic-scope.interface';
import { SourceObservation } from './experience-acquisition.interface';
import {
  AuthorizedExperienceCandidate,
  GeographicValidationAuthorization,
} from './geographic-validation-authorization.interface';
import {
  GeographicValidationDecisionEntity,
  GeographicVerificationStrategy,
} from './geographic-validation.interface';
import type {
  DestinationCompatibilityReason,
  DestinationCompatibilityVerdict,
} from '../utils/destination-compatibility.policy';
import type { PlaceFeatureClass } from '@integrations/google-places/interfaces/places-api.interface';
import type { RouteRetrievalVariantKind } from '../utils/route-retrieval-name.util';
import type { ClassificationFailure } from '../services/experience-classification.service';

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
 * One provider-native identity in its canonical persisted form -- the same
 * `(provider, externalId)` pair a `GeoEntityIdentity` row stores, e.g.
 * `openstreetmap / osm:node:3348573778`, `wikidata / Q111038841`,
 * `geoapify / geoapify:<opaque>`. `provider` is the identity NAMESPACE,
 * never the acquisition strategy that surfaced it (Geoapify can acquire an
 * OpenStreetMap identity).
 */
export interface StrongIdentity {
  provider: string;
  externalId: string;
}

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
  | { type: 'WIKIDATA_UNAVAILABLE' }
  | {
      /**
       * An explicit conflict between what the SOURCE states about this
       * component and what the candidate's own record states. It overrides
       * every positive rule: a unique name, an address, an alias, a
       * catalog memory or two providers repeating one record never
       * establish that the source meant an entity it identifies otherwise.
       *  - WIKIDATA_QID: the cited source declares one QID, the candidate
       *    a different own QID (two identifiers, two entities).
       *  - LOCALITY: the candidate lies outside the administrative boundary
       *    of the locality the source attributes to this component.
       *  - PHYSICAL_KIND: the source states the component's kind (a venue
       *    versus a settlement) and the candidate is structurally the other.
       */
      type: 'IDENTITY_CONTRADICTION';
      fact: 'WIKIDATA_QID';
      sourceQid: string;
      candidateQid: string;
    }
  | {
      type: 'IDENTITY_CONTRADICTION';
      fact: 'LOCALITY';
      assertedLocality: string;
      boundaryId: string;
    }
  | {
      type: 'IDENTITY_CONTRADICTION';
      fact: 'PHYSICAL_KIND';
      assertedKind: ComponentPhysicalKind;
      candidateKind: CandidateStructuralKind;
    }
  | {
      /**
       * The examined same-name pool compared against the component's
       * grounded source locality (and stated kind), projected onto this
       * candidate. Only `DISTINGUISHED` is discriminating correspondence:
       * this candidate is the single member consistent with the source's
       * component-specific facts, over a comparison known not to be cut
       * off. It never comes from proximity or provider rank.
       */
      type: 'CONTEXTUAL_CORRESPONDENCE';
      assertion: 'LOCALITY';
      locality: string;
      coverage: ContextualPoolCoverage;
      memberCount: number;
      consistentCount: number;
      outcome: ContextualPoolOutcome;
    }
  | {
      /**
       * A DIFFERENT, structurally independent acquisition strategy already
       * acquired, for this same hint, a candidate sharing at least one
       * exact strong identity (namespace + canonical id) with this one --
       * e.g. NOMINATIM returning osm:node:3348573778 and PLACES (Geoapify
       * Place Details) declaring the same `openstreetmap/osm:node:
       * 3348573778`. The candidates' identity SETS intersect; `identity` is
       * the shared key. Real-world identity by ID equality, never by
       * name/coordinates: two separate lookup mechanisms landing on the
       * exact same object is strictly stronger than any one fuzzy name
       * match. It is NOT provider-majority voting -- it never counts
       * opinions or picks a winner among competing candidates.
       */
      type: 'IDENTITY_CONVERGENCE';
      priorStrategy: ResolutionStrategy;
      identity: StrongIdentity;
    }
  | {
      /**
       * Provenance of an IDENTITY_CONVERGENCE on `identity`, recorded as its
       * own fact. SHARED_UPSTREAM when both acquisitions derive from one
       * upstream dataset (Overpass, Nominatim and Geoapify indexing one OSM
       * node): one record found twice, which confirms the record but cannot
       * single out a member of a known name collision. `nameCollision` is
       * whether either converging acquisition saw MULTIPLE exact-name or
       * declared-alias members (or an AMBIGUOUS context) in its own pool.
       */
      type: 'CONVERGENCE_PROVENANCE';
      identity: StrongIdentity;
      upstream:
        | 'SHARED_UPSTREAM'
        | 'INDEPENDENT_UPSTREAMS'
        | 'UNDETERMINED_UPSTREAM';
      nameCollision: boolean;
    }
  | {
      /**
       * Targeted ROUTE acquisition produced exactly one structural cluster
       * of real OSM highway ways (exact name tag, OSM topology) that the
       * destination-compatibility policy placed inside the destination.
       * A structural fact about provider-native objects -- the hint name
       * only drove retrieval, never the decision.
       */
      type: 'STRUCTURED_ROUTE_RESOLUTION';
      provider: 'openstreetmap';
      segmentExternalIds: string[];
      destinationCompatibility: DestinationCompatibilityVerdict;
      ambiguity: 'SINGLE_CLUSTER' | 'MULTIPLE_CLUSTERS';
    }
  | {
      /**
       * Catalog-first reuse of an already-canonical ROUTE GeoEntity found by
       * exact name through a bounded route retrieval variant (the generic
       * designator drop: "Defensa Street" -> "Defensa"), within the
       * destination, same kind, destination-compatible.
       */
      type: 'CATALOG_ROUTE_RETRIEVAL_VARIANT_MATCH';
      retrievalVariant: RouteRetrievalVariantKind;
      identityMultiplicity: IdentityMultiplicity;
    }
  | {
      /**
       * Catalog-first reuse through VERIFIED HINT MEMORY: this exact hint
       * text (by its `normalizeGeoName` key) was remembered on the
       * canonical GeoEntity only AFTER an earlier resolution of it ended
       * VERIFIED to that entity (e.g. "Farmacia la Estrella" ->
       * "Farmacia de la Estrella"). A recorded prior verification, never
       * an alias inferred from string similarity. It is kind- and
       * geographic-scope-bounded like every catalog read, and
       * `identityMultiplicity` counts the distinct in-scope GeoEntities
       * matched by canonical name OR remembered key: MULTIPLE never
       * picks a winner.
       */
      type: 'CATALOG_VERIFIED_HINT_MATCH';
      verifiedHintKey: string;
      identityMultiplicity: IdentityMultiplicity;
    };

export type ResolutionStrategy =
  | 'CATALOG_REUSE'
  | 'TRUSTED_OBSERVATION_REUSE'
  | 'TARGETED_ROUTE'
  | 'LOCAL_OSM_POOL'
  | 'NOMINATIM'
  | 'PLACES'
  | 'OVERTURE_IDENTITY'
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
  candidateAcquired: boolean;
  failureReason?: string;
  failureStage?: 'provider_search' | 'boundary_hydration';
  candidateFoundBeforeFailure?: boolean;
  selectedCandidate?: {
    canonicalName: string;
    externalId: string;
    kind: GeoEntityKind;
    /** Every strong identity the candidate carried into verification. */
    identities?: StrongIdentity[];
    /** Candidate representative point, when the provider supplied one. */
    latitude?: number;
    longitude?: number;
  };
  /** Bounded facts of a PLACES text search (no raw payloads). */
  placeSearch?: PlaceSearchAudit;
  identityEvidence: IdentityEvidence[];
  verificationDecision?: VerificationDecision['status'];
  /** Destination-policy verdict that gated this attempt's candidate. */
  destinationCompatibility?: {
    verdict: DestinationCompatibilityVerdict;
    reason: string;
  };
  /** Bounded facts of a TARGETED_ROUTE acquisition (no raw geometry). */
  routeResolution?: {
    status:
      | 'RESOLVED'
      | 'AMBIGUOUS'
      | 'NOT_FOUND'
      | 'INCOMPATIBLE'
      | 'UNAVAILABLE';
    reason: string;
    variants: Array<{
      variant: RouteRetrievalVariantKind;
      name: string;
      rawCount: number;
      acceptedCount: number;
    }>;
    clusterCount: number;
    compatibleClusterCount: number;
    resolvedSegmentCount?: number;
    /** Distinct canonical GeoEntities already owning the resolved segments. */
    knownGeoEntityCount?: number;
  };
}

export interface PlaceSearchAudit {
  resultCount: number;
  /** Results dropped before selection, in provider order. */
  rejected: Array<
    | {
        name: string;
        reason: 'STRUCTURALLY_INCOMPATIBLE';
        featureClass: PlaceFeatureClass;
      }
    | {
        name: string;
        reason: 'DESTINATION_INCOMPATIBLE';
        destinationReason: DestinationCompatibilityReason;
      }
    | {
        name: string;
        /** Outside the candidate's own verified AREA scope (§P2-10). */
        reason: 'OUTSIDE_EXPERIENCE_SCOPE';
      }
  >;
  /** Results left for bounded selection after both filters. */
  viableCount: number;
  /**
   * The identity-search window used, derived from the real geometry of the
   * scope that will later judge the component (spec Part II §P2-10): its
   * provenance plus the covering radius. Never a plausibility constant.
   */
  searchWindow?: {
    provenance: ExperienceGeographicScopeProvenance;
    radiusMeters: number;
  };
  /**
   * Place Details enrichment of the ONE selected candidate: NOT_SUPPORTED
   * when the provider cannot declare cross-identities (no call made).
   */
  identityEnrichment?:
    | { status: 'ENRICHED'; identities: StrongIdentity[] }
    | { status: 'NO_SOURCE_IDENTITIES' }
    | { status: 'NOT_SUPPORTED' }
    | { status: 'FAILED'; failureReason: string };
}

export interface ComponentIdentityContextAudit {
  locality?: ComponentLocalityAssertion & {
    grounding: 'GROUNDED' | 'UNGROUNDED';
    boundaryId?: string;
    boundaryName?: string;
    ungroundedReason?: string;
  };
  physicalKind?: ComponentPhysicalKindAssertion;
  sourceLink?: ComponentSourceLink;
}

export interface ComponentResolutionAudit {
  hintKey: string;
  hintName: string;
  sourceName?: string;
  normalizationKind?: ComponentNormalizationKind;
  role: 'area' | 'waypoint' | 'route' | 'venue';
  expectedKind?: string;
  evidenceKeys: string[];
  addressHint?: string;
  /**
   * The component-specific source context the identity decision used: the
   * stated locality (with its span and whether it was grounded in a real
   * boundary), the stated physical kind and the source link.
   */
  identityContext?: ComponentIdentityContextAudit;
  attempts: ResolutionAttemptAudit[];
  finalStatus: ResolvedGeoEntityStatus;
  finalReason?: string;
  resolvedGeoEntity?: Pick<
    ResolvedGeoEntity,
    'geoEntityId' | 'canonicalName' | 'provider' | 'externalId' | 'persistence'
  >;
  /**
   * Verified hint memory write for this component (only after a VERIFIED
   * external resolution to a GeoEntity of the hint's expected kind):
   * REMEMBERED = the hint key was appended; ALREADY_REMEMBERED = the key
   * was already on that GeoEntity (idempotent no-op); FAILED = the
   * best-effort write failed and resolution was left untouched.
   */
  verifiedHintMemory?: 'REMEMBERED' | 'ALREADY_REMEMBERED' | 'FAILED';
}

export interface CandidateResolutionAudit {
  /** Stable identity generated while the candidate and audit are co-created. */
  candidateTraceKey: string;
  candidateName: string;
  candidateEvidenceKeys: string[];
  candidateHintKeys: string[];
  componentAudits: ComponentResolutionAudit[];
  /** Per-component identity/geography facts + coverage (Stage 4). */
  componentResolution?: CompositeComponentResolution;
  /** The geographic policy this candidate was resolved/validated under. */
  geographicAuthorization: GeographicValidationAuthorization;
  /**
   * The scope phase-2 component acquisition was bounded by (spec Part II
   * §P2-7 two-phase resolution): the candidate-owned scope verified in
   * phase 1, else the destination. Audit fact only.
   */
  componentSearchScope?: ExperienceGeographicScopeProjection;
}

/**
 * Identity outcome of ONE source-backed component. Identity and geography
 * are separate facts: only a RESOLVED component has a canonical object to
 * relate geographically.
 * - UNRESOLVED: no canonical object was established (nothing acquired, or
 *   an acquired candidate was not confirmed, or acquisition could not run).
 * - AMBIGUOUS: competing candidates/clusters and no winner.
 * - CONFLICTED: the verified candidate's strong identities are owned by
 *   several different canonical GeoEntities (never merged).
 */
export type ComponentIdentityStatus =
  | 'RESOLVED'
  | 'UNRESOLVED'
  | 'AMBIGUOUS'
  | 'CONFLICTED';

/** Why a component has no canonical object, from what actually ran. */
export type ComponentDeficitReason =
  | 'NO_CANDIDATE_ACQUIRED'
  /** Acquired, but IdentityVerifier never corroborated it (not contradicted). */
  | 'CANDIDATE_UNCONFIRMED'
  /** Acquired, and IdentityVerifier REJECTED every acquired candidate. */
  | 'CANDIDATE_REJECTED'
  | 'AMBIGUOUS_CANDIDATES'
  | 'IDENTITY_CONFLICT'
  | 'PROVIDER_FAILURE'
  | 'DESTINATION_INCOMPATIBLE'
  | 'DESTINATION_COMPATIBILITY_UNKNOWN';

/**
 * Only a genuine world-knowledge ambiguity is a KNOWLEDGE_DEFICIT (a future
 * Tourism Researcher input). A provider that could not run is an
 * OPERATIONAL_FAILURE. Everything else (nothing acquired, candidate not
 * confirmed, identity conflict, destination gate) can be either a knowledge
 * gap or a resolver/acquisition defect; runtime code cannot tell which, so
 * it stays PENDING_CLASSIFICATION for forensic review instead of being
 * disguised as research.
 */
export type ComponentDeficitClassification =
  | 'KNOWLEDGE_DEFICIT'
  | 'OPERATIONAL_FAILURE'
  | 'PENDING_CLASSIFICATION';

/**
 * The scope component relations were computed against: the candidate's own
 * verified scope when one was established, else the work-unit anchor, else
 * the destination. Same provenance vocabulary as `ExperienceGeographicScope`.
 */
export type ComponentGeographicScope =
  | {
      kind: 'SCOPE';
      provenance: ExperienceGeographicScopeProvenance;
      name?: string;
      radiusMeters?: number;
    }
  | { kind: 'UNAVAILABLE' };

export interface ComponentResolutionFact {
  hintKey: string;
  hintName: string;
  role: GeoEntityHint['role'];
  expectedKind?: string;
  evidenceKeys: string[];
  /**
   * 1-based position in the source's evidenced visiting sequence; null when
   * the source declares no order (array order is never a sequence).
   */
  sourceOrder: number | null;
  identityStatus: ComponentIdentityStatus;
  /** Present only when identityStatus is RESOLVED. */
  resolved?: {
    geoEntityId?: string;
    geoEntityKind?: GeoEntityKind;
    canonicalGeometry: ComponentGeometryBasis;
    /** Relation to the request scope; UNDETERMINED is never INSIDE/OUTSIDE. */
    geographicRelation: ComponentAreaRelation;
    distanceToBoundaryMeters?: number;
  };
  /** Present only when identityStatus is not RESOLVED. */
  deficit?: {
    reason: ComponentDeficitReason;
    classification: ComponentDeficitClassification;
  };
}

/**
 * Observability of a source-backed composition. Counts are over every
 * source-backed component; `resolutionRatio` is NOT an acceptance
 * threshold. `sourceCompositionComplete` is the only admission fact: every
 * source component has a RESOLVED canonical identity.
 */
export interface CompositeResolutionCoverage {
  totalComponents: number;
  identityResolvedComponents: number;
  /** RESOLVED components whose relation is INSIDE or INTERSECTS. */
  geographicallyAcceptedComponents: number;
  unresolvedComponents: number;
  ambiguousComponents: number;
  conflictedComponents: number;
  resolutionRatio: number;
  /** hintKeys whose deficit is a genuine KNOWLEDGE_DEFICIT. */
  openResearchDeficits: string[];
  sourceCompositionComplete: boolean;
}

export interface CompositeComponentResolution {
  scope: ComponentGeographicScope;
  components: ComponentResolutionFact[];
  coverage: CompositeResolutionCoverage;
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
  /**
   * The COMPLETE set of strong provider-native identities of this ONE real
   * entity -- the canonical correlation facts (IDENTITY_CONVERGENCE is their
   * intersection across strategies) and exactly what persists as
   * GeoEntityIdentity rows. Present when the entity carries more than its
   * acquisition handle: a multi-way ROUTE (one identity per OSM way), a
   * PLACE whose provider declared cross-identities (Geoapify Place Details
   * -> OSM object, Wikidata QID). `provider`/`externalId` above stay the
   * primary acquisition handle and are always a member of this set; when
   * absent, that single pair is the only strong identity.
   */
  identities?: StrongIdentity[];
  /** Coarse structural kind, normalized at the provider boundary. */
  structuralKind?: CandidateStructuralKind;
  /**
   * Upstream datasets this record derives from (`openstreetmap` for an OSM
   * node however it was reached, `overture:meta` for a Meta-sourced
   * Overture row). Two acquisitions sharing an upstream are not
   * independent corroboration of each other.
   */
  upstreamDatasets?: string[];
  /** The contextual evaluation of the pool this candidate was taken from. */
  contextualPool?: ContextualPoolEvaluation;
}

export interface ResolvedGeoEntity {
  hintKey: string;
  hintName: string;
  provider: string;
  externalId?: string;
  /** Present only after the resolver persists a VERIFIED EntityCandidate. */
  geoEntityId?: string;
  /**
   * Outcome of multi-identity persistence (identity-only reconciliation):
   * a new GeoEntity, or an existing one that already owned some of the
   * candidate's identities (the missing ones attached). Audit-only.
   */
  persistence?: {
    status: 'CREATED' | 'REUSED';
    attachedExternalIds: string[];
  };
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
  /** Canonical physical kind of the resolved object, when resolved. */
  kind?: GeoEntityKind;
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
  /**
   * Stage 4: every source component's identity/geography facts and the
   * composition's coverage, including unresolved/ambiguous components.
   * Transient (trace/audit only); never persisted as a partial Experience.
   */
  componentResolution?: CompositeComponentResolution;
  /**
   * The geographic policy the resolver applied to THIS candidate (paired on
   * the request, see AuthorizedExperienceCandidate). Transient audit fact.
   */
  geographicAuthorization?: GeographicValidationAuthorization;
  experienceId?: string;
  dedupeDecision?: 'SAME' | 'NEW' | 'AMBIGUOUS';
  dedupeEvidence?: DedupeEvidence;
  dedupeCandidates?: string[];
}

export interface ExperienceResolutionRequest {
  /**
   * Each candidate already paired with the geographic authorization of the
   * work unit that produced it. There is no batch-level geographic policy.
   */
  candidates: AuthorizedExperienceCandidate[];
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
  /** Task B5 — see WorkUnitAnchorScope. Absent for every caller other
   * than AreaRouteWalkAcquisitionService (ordinary generation-loop
   * deficits, acquireNearby) — no behavior change there. */
  validationScope?: WorkUnitAnchorScope;
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
  strategy?: GeographicVerificationStrategy;
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
  routeScopeMembership?: RouteScopeMembershipAudit;
  /** Exact entities used by the canonical decision; trace never infers offenders. */
  decisionEntities?: GeographicValidationDecisionEntity[];
  /** The Experience scope the decision was made against (§P2-7). */
  experienceScope?: ExperienceGeographicScopeProjection;
  /** Trip-relative fact (§P2-9); never a validity gate for a verified scope. */
  destinationRelation?: ExperienceDestinationRelation;
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
    failure?: ClassificationFailure;
  }>;
}

export interface FinalExperienceResolutionResponse
  extends ExperienceResolutionResponse {
  geographicValidation: ExperienceGeographicValidationBatchResult;
  validationScope?: WorkUnitAnchorScope;
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
