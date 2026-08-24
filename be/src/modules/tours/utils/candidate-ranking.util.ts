// Interest-aware, source-agnostic candidate ranking. A POI and a composite
// walk are scored on the same 0-ish scale instead of competing on Google
// rating alone — see docs/superpowers/specs/2026-08-21-activity-engine-design.md,
// "Unified, interest-aware candidate ranking".
export interface RankableCandidate {
  id: string;
  source: 'poi' | 'composite';
  kind?: string;
  subtype?: string;
  /** Distance from the resolved destination search origin, in kilometers. */
  distanceKm?: number;
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
const PROXIMITY_WEIGHT = 0.1;
const NEW_KIND_BONUS = 0.04;
const NEW_SUBTYPE_BONUS = 0.03;
const REPEATED_SUBTYPE_PENALTY = 0.02;

function qualityBonus(candidate: RankableCandidate): number {
  if (candidate.source === 'poi') {
    return (
      ((candidate.weightedScore ?? 0) / MAX_WEIGHTED_SCORE) * POI_QUALITY_WEIGHT
    );
  }
  return candidate.isCurated ? CURATED_COMPOSITE_BONUS : 0;
}

function proximityBonus(
  candidate: RankableCandidate,
  maximumDistanceKm: number,
): number {
  if (!Number.isFinite(candidate.distanceKm) || maximumDistanceKm <= 0) {
    return 0;
  }
  return (
    Math.max(
      0,
      1 - (candidate.distanceKm ?? maximumDistanceKm) / maximumDistanceKm,
    ) * PROXIMITY_WEIGHT
  );
}

function fallbackCompare(a: RankableCandidate, b: RankableCandidate): number {
  const qualityDifference = qualityBonus(b) - qualityBonus(a);
  if (Math.abs(qualityDifference) > Number.EPSILON) return qualityDifference;

  const distanceDifference =
    (a.distanceKm ?? Number.POSITIVE_INFINITY) -
    (b.distanceKm ?? Number.POSITIVE_INFINITY);
  if (Math.abs(distanceDifference) > Number.EPSILON) return distanceDifference;
  return a.id.localeCompare(b.id);
}

function rankKnownSemanticTier<T extends RankableCandidate>(
  candidates: T[],
  similarityById: Map<string, number>,
): T[] {
  const maximumDistanceKm = Math.max(
    0,
    ...candidates
      .map((candidate) => candidate.distanceKm)
      .filter((distance): distance is number => Number.isFinite(distance)),
  );
  const remaining = candidates.map((candidate) => ({
    candidate,
    baseScore:
      similarityById.get(candidate.id)! +
      qualityBonus(candidate) +
      proximityBonus(candidate, maximumDistanceKm),
  }));
  const selected: T[] = [];
  const selectedKinds = new Set<string>();
  const subtypeCounts = new Map<string, number>();

  while (remaining.length > 0) {
    remaining.sort((a, b) => {
      const score = (entry: (typeof remaining)[number]) => {
        const kind = entry.candidate.kind ?? entry.candidate.source;
        const subtype = entry.candidate.subtype;
        const subtypeCount = subtype ? (subtypeCounts.get(subtype) ?? 0) : 0;
        return (
          entry.baseScore +
          (selectedKinds.has(kind) ? 0 : NEW_KIND_BONUS) +
          (subtype && subtypeCount === 0 ? NEW_SUBTYPE_BONUS : 0) -
          Math.min(0.1, subtypeCount * REPEATED_SUBTYPE_PENALTY)
        );
      };
      const scoreDifference = score(b) - score(a);
      if (Math.abs(scoreDifference) > Number.EPSILON) return scoreDifference;
      return fallbackCompare(a.candidate, b.candidate);
    });

    const next = remaining.shift()!.candidate;
    selected.push(next);
    selectedKinds.add(next.kind ?? next.source);
    if (next.subtype) {
      subtypeCounts.set(
        next.subtype,
        (subtypeCounts.get(next.subtype) ?? 0) + 1,
      );
    }
  }

  return selected;
}

/**
 * Sorts candidates descending by relevance. With no interest signal
 * (`similarityById === null` — the caller passes this when `interests` is
 * empty or embeddings are unavailable), falls back to exactly today's
 * weightedScore-only order, so a request with no interests keeps its
 * existing behavior. Candidates absent from `similarityById` have unknown
 * semantic relevance: they are ranked deterministically by non-semantic
 * signals after the compatible indexed tier, never converted into a fake
 * zero-similarity measurement.
 */
export function rankCandidatesByRelevance<T extends RankableCandidate>(
  candidates: T[],
  similarityById: Map<string, number> | null,
): T[] {
  if (!similarityById) {
    return [...candidates].sort(fallbackCompare);
  }

  const semanticallyIndexed = candidates.filter((candidate) =>
    similarityById.has(candidate.id),
  );
  const missingEmbedding = candidates.filter(
    (candidate) => !similarityById.has(candidate.id),
  );

  return [
    ...rankKnownSemanticTier(semanticallyIndexed, similarityById),
    ...missingEmbedding.sort(fallbackCompare),
  ];
}
