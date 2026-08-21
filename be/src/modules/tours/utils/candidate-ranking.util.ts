// Interest-aware, source-agnostic candidate ranking. A POI and a composite
// walk are scored on the same 0-ish scale instead of competing on Google
// rating alone — see docs/superpowers/specs/2026-08-21-activity-engine-design.md,
// "Unified, interest-aware candidate ranking".
export interface RankableCandidate {
  id: string;
  source: 'poi' | 'composite';
  /** POI only — ActivitiesService.findAll's Bayesian-weighted rating, 0-5. */
  weightedScore?: number;
  /** Composite only — true for a pre-vetted generate-templates variant. */
  isCurated?: boolean;
}

const MAX_WEIGHTED_SCORE = 5;
// Small on purpose relative to interestSimilarity's 0-1 range — quality is a
// tie-breaker here, not the primary signal, unlike ActivitiesService.findAll's
// own weightedScore-first sort (which this function does not replace, only
// feeds from, when interests are present).
const POI_QUALITY_WEIGHT = 0.2;
// Deliberately less than POI_QUALITY_WEIGHT's max (0.2) — a curated composite
// is a solid signal but shouldn't automatically outrank a very well-reviewed
// matching POI on interest similarity alone.
const CURATED_COMPOSITE_BONUS = 0.15;

function qualityBonus(candidate: RankableCandidate): number {
  if (candidate.source === 'poi') {
    return ((candidate.weightedScore ?? 0) / MAX_WEIGHTED_SCORE) * POI_QUALITY_WEIGHT;
  }
  return candidate.isCurated ? CURATED_COMPOSITE_BONUS : 0;
}

/**
 * Sorts candidates descending by relevance. With no interest signal
 * (`similarityById === null` — the caller passes this when `interests` is
 * empty or embeddings are unavailable), falls back to exactly today's
 * weightedScore-only order, so a request with no interests keeps its
 * existing behavior. A candidate absent from `similarityById` (no indexed
 * embedding) is treated as zero interest similarity, not an error.
 */
export function rankCandidatesByRelevance<T extends RankableCandidate>(
  candidates: T[],
  similarityById: Map<string, number> | null,
): T[] {
  if (!similarityById) {
    return [...candidates].sort((a, b) => (b.weightedScore ?? 0) - (a.weightedScore ?? 0));
  }

  return [...candidates]
    .map((candidate) => ({
      candidate,
      relevance: (similarityById.get(candidate.id) ?? 0) + qualityBonus(candidate),
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .map((s) => s.candidate);
}
