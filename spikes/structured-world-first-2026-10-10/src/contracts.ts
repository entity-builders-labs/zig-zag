/**
 * Revision 2 contracts (design R2, R10): structured world first. Extends the
 * spike 1 contracts without modifying them.
 */
import {
  ClaimType,
  EvidenceCapture,
  FacetKey,
  GeoEntityKind,
  InterpretedRequest,
  ResearchBudgetUsage,
} from './spike1';

export type AreaClass = 'ADMINISTRATIVE' | 'NAMED_PLACE';
export type AreaExtent = 'PROVIDER_BOUNDARY' | 'UNKNOWN';
export type DiscoveryKind = 'AREA' | 'PLACE' | 'ROUTE';

/** A field-level fact from a structured provider record. */
export interface StructuredFact {
  source: 'openstreetmap' | 'wikidata';
  /** Provider record that carries the field (e.g. `osm:way:1`, `Q123`). */
  recordId: string;
  /** Field path, e.g. `tag:historic`, `P1435`, `class:museum`. */
  field: string;
  value: string;
  label?: string;
}

/**
 * Typed L1 extension for revision 2: written only by the discovery
 * boundary under the geography-resolution authority.
 */
export interface CandidateFacts {
  geoEntityId: string;
  kind: GeoEntityKind;
  /** Canonical name first, then provider aliases (never model text). */
  names: string[];
  areaClass?: AreaClass;
  extent?: AreaExtent;
  /** Administrative areas containing this candidate, from provider geometry. */
  parentAreaIds: string[];
  discoveredBy: { kind: DiscoveryKind; scopeId: string; strategies: string[] };
  wikidataQid?: string;
  facts: StructuredFact[];
  prominence: { sitelinks?: number; tagSignals: string[] };
}

export type GapType2 =
  | 'AREA_CANDIDATES'
  | 'AREA_RELEVANCE'
  | 'PLACE_CANDIDATES'
  | 'PLACE_RELEVANCE'
  | 'ROUTE_CANDIDATES'
  | 'WALKING_CORRIDOR_RELEVANCE'
  | 'SCHEDULE_CAPACITY';

export type GapKind = 'DISCOVERY' | 'MEANING' | 'META';

/** One unit of semantic evaluation: claim type x canonical candidate x facet. */
export interface EvaluationQuestion {
  key: string;
  claimType: ClaimType;
  candidateId: string;
  facetKey: FacetKey;
  /** NOTABLE_WITHIN / corridor scope area. */
  areaId?: string;
  /** Corridor questions: offered canonical anchors (places/areas) in the area. */
  anchorIds?: string[];
}

export interface Gap2 {
  key: string;
  type: GapType2;
  kind: GapKind;
  scopeId: string;
  facetKey?: FacetKey;
  threshold: number;
  observed: number;
  questions: EvaluationQuestion[];
  /** Capacity lineage: what this gap expands into. */
  lineage?: string;
}

export type Verdict2 =
  | { verdict: 'READY'; limitations: Limitation[]; policyVersion: string }
  | { verdict: 'GAPS'; gaps: Gap2[]; limitations: Limitation[]; policyVersion: string }
  | { verdict: 'INSUFFICIENT_KNOWLEDGE'; limitations: Limitation[]; policyVersion: string };

export interface Limitation {
  key: string;
  type: GapType2;
  scopeId: string;
  facetKey?: FacetKey;
  reason: 'QUESTIONS_EXHAUSTED' | 'DISCOVERY_EMPTY' | 'NO_BOUNDED_AREA';
}

export type SourceClass =
  | 'GEOGRAPHIC_STRUCTURE'
  | 'STRUCTURED_POI'
  | 'STRUCTURED_ENTITY_FACTS'
  | 'ROUTE_GEOMETRY'
  | 'RESEARCH_MEMORY'
  | 'WEB_EVIDENCE';

export interface Strategy {
  id: string;
  sourceClass: SourceClass;
  provider: string;
}

export interface RouteDecision {
  gapKey: string;
  policyVersion: string;
  strategies: Strategy[];
  unavailable: Strategy[];
}

/** A claim proposed by the evaluator; it answers one offered question. */
export interface ProposedAnswer {
  questionKey: string;
  claimType: ClaimType;
  candidateId: string;
  facetKey: FacetKey;
  areaId?: string;
  fromId?: string;
  toId?: string;
  captures: EvidenceCapture[];
  proposedAuthorityClass?: string;
  origin: 'STRUCTURED_FACTS' | 'RESEARCH_MEMORY' | 'WEB_EVIDENCE';
}

export interface UnofferedMention {
  name: string;
  gapKey: string;
  context: string;
  at: string;
}

export interface EvaluatorOutcome {
  gapKey: string;
  kind: 'CLAIMS_PROPOSED' | 'BUDGET_EXHAUSTED' | 'NO_EVIDENCE_FOUND' | 'TOOL_FAILURE';
  answers: ProposedAnswer[];
  discarded: Array<{ reason: 'NO_CAPTURE' | 'NOT_OFFERED_CANDIDATE' | 'UNKNOWN_QUESTION' | 'CLAIM_TYPE_MISMATCH'; detail: string }>;
  mentions: UnofferedMention[];
  budgetUsed: ResearchBudgetUsage;
  failure?: string;
}

export type GroundingReason2 =
  | 'NOT_OFFERED_CANDIDATE'
  | 'EVIDENCE_DOES_NOT_NAME_SUBJECT'
  | 'EVIDENCE_NOT_REPRODUCIBLE'
  | 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM'
  | 'INSUFFICIENT_CORROBORATION'
  | 'GEOMETRY_INCONSISTENT'
  | 'CORRIDOR_BOUNDS_UNRESOLVED';

export type Grounding2Result =
  | {
      status: 'AUTHORIZED';
      question: EvaluationQuestion;
      assertionKeys: string[];
      basis: 'SINGLE_VERIFIED_EXPLICIT' | 'INDEPENDENT_CORROBORATION';
      captures: EvidenceCapture[];
      routeCorrespondence?: Array<{ anchorId: string; meters: number }>;
    }
  | { status: 'REJECTED'; question: EvaluationQuestion; reason: GroundingReason2; detail?: string; captures: EvidenceCapture[] }
  | { status: 'FAILED'; question: EvaluationQuestion; reason: 'FETCH_UNAVAILABLE' | 'VERIFIER_UNAVAILABLE' | 'STRUCTURED_REFETCH_UNAVAILABLE'; detail?: string };

export type { InterpretedRequest };
