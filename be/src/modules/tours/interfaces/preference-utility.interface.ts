/**
 * The canonical preference-utility boundary (task 25.2; design "P-D7
 * preference-first objective"). Preference utility is derived once per
 * request snapshot and consumed by composition, planning and the trace; no
 * consumer recombines its levels into a scalar.
 *
 * Canonical within-request order (lexicographic, no exchange rate):
 * 1. DIRECT evidence    — Σ stated importance of strongly matched DIRECT
 *                         facets (higher first; confidence never discounts);
 * 2. INFERRED evidence  — Σ importance × confidence of strongly matched
 *                         INFERRED facets (higher first);
 * 3. avoidance          — confirmed typed facts matching SOFT EXCLUDE
 *                         targets: DIRECT Σ importance, then INFERRED
 *                         Σ importance × confidence (lower first); an absent
 *                         fact is neutral, never proof of avoidance;
 * 4. soft venue anchor  — a separate typed signal, never a facet match;
 * 5. semantic affinity  — KNOWN similarity; UNKNOWN orders at the median of
 *                         KNOWN peers in the same levels-1..4 tier;
 * 6. generic quality    — KNOWN 0..5 score; UNKNOWN orders at the tier
 *                         median the same way;
 * 7. Experience id.
 *
 * The median is an ordering projection only: the breakdown keeps UNKNOWN.
 */
export const PREFERENCE_UTILITY_POLICY_VERSION = 'preference-utility-v1';

export type SemanticAffinity =
  | { status: 'KNOWN'; similarity: number }
  | {
      status: 'UNKNOWN';
      reason: 'EMPTY_QUERY' | 'NO_COMPATIBLE_EMBEDDING' | 'PROVIDER_UNAVAILABLE';
    };

export type GenericQuality =
  | { status: 'KNOWN'; score: number }
  | { status: 'UNKNOWN'; reason: 'NO_QUALITY_SIGNAL' };

/**
 * The typed, explainable per-Experience breakdown. Numeric only: it carries
 * no embedding, text or facet structure, so it may cross into the planner.
 */
export interface PreferenceUtilityBreakdown {
  /** Σ stated importance of strongly matched DIRECT facets. */
  directEvidence: number;
  /** Σ importance × confidence of strongly matched INFERRED facets. */
  inferredEvidence: number;
  /** Confirmed conflicts with SOFT EXCLUDE targets (lower is better). */
  avoidance: { directConflict: number; inferredConflict: number };
  softAnchor: boolean;
  semantic: SemanticAffinity;
  /** Generic, not preference: the canonical 0..5 quality score. */
  quality: GenericQuality;
}

export interface PreferenceUtilityAssessment {
  experienceId: string;
  breakdown: PreferenceUtilityBreakdown;
  /** Strict within-request rank (1 = best), ties broken by id. */
  rank: number;
  /**
   * Dense rank over the canonical levels 1–6 only (1 = best); candidates
   * equal on every level share it. Composition-local keys (exploration
   * tilt) may order inside one level rank, never across them.
   */
  levelRank: number;
  /** Requested facet keys strongly matched (composition coverage, trace). */
  matchedFacets: string[];
  /** SOFT EXCLUDE target keys with a confirmed conflicting fact (trace). */
  avoidedTargets: string[];
}

export interface PreferenceUtilityResult {
  policyVersion: typeof PREFERENCE_UTILITY_POLICY_VERSION;
  /** Experience ids in canonical order. */
  order: string[];
  byId: Map<string, PreferenceUtilityAssessment>;
  semanticRanking: {
    status: 'not_requested' | 'applied' | 'unavailable';
    requestedCandidateCount: number;
    indexedCandidateCount: number;
    identity?: import('@shared/ai/interfaces/embedding-index.interface').EmbeddingIndexIdentity;
    reason?: string;
  };
}

/** What the planner receives per candidate in place of untyped scores. */
export interface PlanningPreference {
  policyVersion: string;
  rank: number;
  breakdown: PreferenceUtilityBreakdown;
}
