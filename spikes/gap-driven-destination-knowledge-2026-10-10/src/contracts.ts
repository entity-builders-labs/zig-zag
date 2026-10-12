/**
 * Typed contracts of the destination knowledge catalog (design D4).
 *
 * Spike-local, intended as templates for the production cutover. Nothing
 * here is imported by production code.
 */
import { MobilityPreferences } from '../../../be/src/modules/tours/interfaces/tour-generation.interface';

export type GeoEntityKind = 'PLACE' | 'AREA' | 'ROUTE';

export interface ProviderIdentity {
  provider: string;
  externalId: string;
}

export interface LngLat {
  lng: number;
  lat: number;
}

/** GeoJSON-like geometry as stored by L1 (provider-backed only). */
export type GeoGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] };

/** L1: geography. Exists only with a provider identity and geometry. */
export interface GeoEntityRef {
  id: string;
  kind: GeoEntityKind;
  name: string;
  identities: ProviderIdentity[];
  geometry: GeoGeometry;
  /** Representative point, provider-supplied or derived from geometry. */
  centroid: LngLat;
}

export type SegmentBound =
  | { kind: 'GEO_ENTITY'; geoEntityId: string }
  | { kind: 'AREA_CLIP'; areaGeoEntityId: string };

export type CorridorBoundKind = 'STATED_ANCHORS' | 'AREA_CLIP';

export interface CorridorSubject {
  routeGeoEntityId: string;
  /** Canonically ordered (see keys.ts): `from` sorts before `to`. */
  from: SegmentBound;
  to: SegmentBound;
  boundKind: CorridorBoundKind;
}

export type ClaimType = 'RELEVANT_FOR' | 'NOTABLE_WITHIN' | 'WALKING_CORRIDOR';

export type AssertionSubject =
  | { kind: 'GEO_ENTITY'; geoEntityId: string }
  | { kind: 'PLACE_IN_AREA'; placeGeoEntityId: string; areaGeoEntityId: string }
  | { kind: 'CORRIDOR'; corridor: CorridorSubject };

/** A canonical facet key, `<dimension>:<key>` (e.g. `theme:history`). */
export type FacetKey = string;

export type EvidenceLocator =
  | { kind: 'URL'; url: string }
  | { kind: 'DATASET_RECORD'; dataset: string; recordId: string; fieldPath: string };

export type EvidenceCaptureBody =
  | { kind: 'PROSE_SPAN'; start: number; end: number; text: string }
  | { kind: 'STRUCTURED_FIELD'; values: Record<string, string> };

export type ProvenanceSignal =
  | { kind: 'REPRODUCIBLE'; refetchedAt: string; fingerprintDrift: boolean }
  | {
      kind: 'PUBLISHER_ESTABLISHED';
      publisher: string;
      /** The machine-checkable property that established the publisher. */
      basis: 'JSON_LD_ORGANIZATION_URL_MATCHES_HOST';
      registrableDomain: string;
    }
  | { kind: 'GOVERNMENT_HOSTED'; registrableDomain: string };

export type SupportLevel = 'EXPLICIT' | 'IMPLICIT' | 'NONE';

export interface SupportVerdict {
  claimKey: string;
  level: SupportLevel;
  verifier: { provider: string; model: string };
  rationale?: string;
}

export interface EvidenceCapture {
  id: string;
  locator: EvidenceLocator;
  retrievedAt: string;
  contentFingerprint: string;
  capture: EvidenceCaptureBody;
  /** Untrusted hint from the research agent; never read by a predicate. */
  proposedAuthorityClass?: string;
  /** Registrable domain of the locator host (independence fallback). */
  registrableDomain?: string;
  provenanceSignals: ProvenanceSignal[];
  supportVerdicts: SupportVerdict[];
}

export interface Assertion {
  key: string;
  claimType: ClaimType;
  subject: AssertionSubject;
  facetKey: FacetKey;
  destinationId: string;
  evidence: EvidenceCapture[];
  status: 'ACTIVE' | 'RETRACTED';
  createdAt: string;
}

export type GapType =
  | 'AREA_RELEVANCE'
  | 'NOTABLE_PLACES'
  | 'WALKING_CORRIDOR'
  | 'SCHEDULE_CAPACITY';

export interface KnowledgeGap {
  key: string;
  type: GapType;
  scopeGeoEntityId: string;
  /** Single facet for facet gaps; sorted joined facets for capacity. */
  facetKey: FacetKey;
  threshold: number;
  observed: number;
  /** Areas known when the gap was emitted (capacity exclusions). */
  knownAreaIds: string[];
  /** Areas relevant to the request's thematic facets (corridor search). */
  relevantAreaIds: string[];
}

export type GapOutcome =
  | 'SATISFIED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'BUDGET_EXHAUSTED'
  | 'FAILED';

export interface LedgerEntry {
  gapKey: string;
  outcome: GapOutcome;
  budgetUsed: ResearchBudgetUsage;
  snapshotEpoch: number;
  at: string;
}

export interface ResearchBudget {
  maxRounds: number;
  maxSearches: number;
  maxFetches: number;
}

export interface ResearchBudgetUsage {
  rounds: number;
  searches: number;
  fetches: number;
}

export type ResearchOutcomeKind =
  | 'CLAIMS_PROPOSED'
  | 'BUDGET_EXHAUSTED'
  | 'NO_EVIDENCE_FOUND'
  | 'TOOL_FAILURE';

/** A claim proposed by research. Untrusted until grounding authorizes it. */
export interface ProposedClaim {
  claimType: ClaimType;
  subjectMention: string;
  /** NOTABLE_WITHIN: the area the place is claimed to be in. */
  areaMention?: string;
  /** WALKING_CORRIDOR: stated endpoints, when the evidence states them. */
  fromMention?: string;
  toMention?: string;
  proposedThemes: string[];
  captures: EvidenceCapture[];
  proposedAuthorityClass?: string;
}

export interface ResearchOutcome {
  gapKey: string;
  kind: ResearchOutcomeKind;
  claims: ProposedClaim[];
  discarded: Array<{ reason: 'NO_CAPTURE' | 'CLAIM_TYPE_NOT_PERMITTED' | 'EXCLUDED_SUBJECT'; claim: Partial<ProposedClaim> }>;
  budgetUsed: ResearchBudgetUsage;
  snapshotEpoch: number;
  failure?: string;
}

export type RejectionReason =
  | 'EVIDENCE_NOT_REPRODUCIBLE'
  | 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM'
  | 'INSUFFICIENT_CORROBORATION'
  | 'IDENTITY_AMBIGUOUS'
  | 'IDENTITY_NOT_FOUND'
  | 'GEOMETRY_INCONSISTENT'
  | 'DESTINATION_INCOMPATIBLE'
  | 'CORRIDOR_BOUNDS_UNRESOLVED'
  | 'NO_CANONICAL_FACET';

export type FailureReason = 'RESOLUTION_UNAVAILABLE' | 'FETCH_UNAVAILABLE' | 'VERIFIER_UNAVAILABLE';

export type GroundingResult =
  | {
      status: 'AUTHORIZED';
      claim: ProposedClaim;
      assertions: Assertion[];
      /** Facets of the same claim that did not meet sufficiency. */
      facetRejections: Array<{ facetKey: FacetKey; reason: RejectionReason }>;
    }
  | { status: 'REJECTED'; claim: ProposedClaim; reason: RejectionReason; detail?: string }
  | { status: 'FAILED'; claim: ProposedClaim; reason: FailureReason; detail?: string };

export type UnitKind = 'PLACE_VISIT' | 'CORRIDOR_WALK';

export interface ExperienceStop {
  geoEntityId: string;
  name: string;
  point: LngLat;
  required: boolean;
  /** Position along the corridor from its canonical start, meters. */
  alongMeters?: number;
}

export interface ReusableExperienceContent {
  name: string;
  stops: ExperienceStop[];
  durationMinutes: number;
  /** POINT for PLACE_VISIT, LINE for CORRIDOR_WALK. */
  footprint:
    | { type: 'POINT'; point: LngLat }
    | { type: 'LINE'; line: LngLat[] };
  facetKeys: FacetKey[];
}

export interface ReusableExperience {
  key: string;
  unitKind: UnitKind;
  anchors: string[];
  justification: string[];
  contentRevision: number;
  policyVersion: string;
  content: ReusableExperienceContent;
  status: 'ACTIVE' | 'ARCHIVED';
}

/** Request after deterministic interpretation (spike: structured wizard terms). */
export interface InterpretedRequest {
  destinationLabel: string;
  days: number;
  thematicFacets: FacetKey[];
  experienceFormatFacets: FacetKey[];
  /** Explicit wizard mobility input (the wizard requires these values). */
  mobility: MobilityPreferences;
}
