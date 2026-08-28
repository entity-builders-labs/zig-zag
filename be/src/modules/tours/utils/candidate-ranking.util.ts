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
  /** Composite only — groups variants of the same area+experience-type, used for window-selection family diversity (candidate-window-selection.util.ts). */
  familyId?: string | null;
}

// PR 9: exposes what actually drove a candidate's rank, so the generation
// bitácora can show real per-candidate score components instead of an
// opaque total — see docs/superpowers/plans/2026-08-21-activity-engine-
// quality-discovery-mobility.md, "PR 9: Unified candidate pool".
export interface CandidateScoreBreakdown {
  /** null = missing-embedding tier; never a fake 0 (that would claim a measurement that didn't happen). */
  semanticSimilarity: number | null;
  qualityBonus: number;
  proximityBonus: number;
  /** Captured at the moment this candidate was selected in the greedy diversity pass, not recomputed afterward. */
  diversityBonus: number;
  totalScore: number;
}

export interface RankedCandidate<T extends RankableCandidate> {
  candidate: T;
  scoreBreakdown: CandidateScoreBreakdown;
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

export function qualityBonus(candidate: RankableCandidate): number {
  if (candidate.source === 'poi') {
    return (
      ((candidate.weightedScore ?? 0) / MAX_WEIGHTED_SCORE) * POI_QUALITY_WEIGHT
    );
  }
  return candidate.isCurated ? CURATED_COMPOSITE_BONUS : 0;
}

export function proximityBonus(
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

// Shared by the live comparator (re-evaluated every sort pass, current
// state) and the post-shift capture (frozen at the exact moment a
// candidate is selected) — factored out so the two can't drift apart.
function diversityBonusFor(
  candidate: RankableCandidate,
  selectedKinds: Set<string>,
  subtypeCounts: Map<string, number>,
): number {
  const kind = candidate.kind ?? candidate.source;
  const subtype = candidate.subtype;
  const subtypeCount = subtype ? (subtypeCounts.get(subtype) ?? 0) : 0;
  return (
    (selectedKinds.has(kind) ? 0 : NEW_KIND_BONUS) +
    (subtype && subtypeCount === 0 ? NEW_SUBTYPE_BONUS : 0) -
    Math.min(0.1, subtypeCount * REPEATED_SUBTYPE_PENALTY)
  );
}

function rankKnownSemanticTier<T extends RankableCandidate>(
  candidates: T[],
  similarityById: Map<string, number>,
): RankedCandidate<T>[] {
  const maximumDistanceKm = Math.max(
    0,
    ...candidates
      .map((candidate) => candidate.distanceKm)
      .filter((distance): distance is number => Number.isFinite(distance)),
  );
  const remaining = candidates.map((candidate) => ({
    candidate,
    semanticSimilarity: similarityById.get(candidate.id)!,
    quality: qualityBonus(candidate),
    proximity: proximityBonus(candidate, maximumDistanceKm),
    baseScore:
      similarityById.get(candidate.id)! +
      qualityBonus(candidate) +
      proximityBonus(candidate, maximumDistanceKm),
  }));
  const selected: RankedCandidate<T>[] = [];
  const selectedKinds = new Set<string>();
  const subtypeCounts = new Map<string, number>();

  while (remaining.length > 0) {
    remaining.sort((a, b) => {
      const score = (entry: (typeof remaining)[number]) =>
        entry.baseScore +
        diversityBonusFor(entry.candidate, selectedKinds, subtypeCounts);
      const scoreDifference = score(b) - score(a);
      if (Math.abs(scoreDifference) > Number.EPSILON) return scoreDifference;
      return fallbackCompare(a.candidate, b.candidate);
    });

    const next = remaining.shift()!;
    // Capture diversityBonus from the state exactly as it stood at
    // selection time, before this pick updates selectedKinds/subtypeCounts
    // below — recomputing afterward would use every-candidate-but-the-last's
    // wrong (post-mutation) state.
    const diversityBonus = diversityBonusFor(
      next.candidate,
      selectedKinds,
      subtypeCounts,
    );
    selected.push({
      candidate: next.candidate,
      scoreBreakdown: {
        semanticSimilarity: next.semanticSimilarity,
        qualityBonus: next.quality,
        proximityBonus: next.proximity,
        diversityBonus,
        totalScore: next.baseScore + diversityBonus,
      },
    });
    const kind = next.candidate.kind ?? next.candidate.source;
    selectedKinds.add(kind);
    if (next.candidate.subtype) {
      subtypeCounts.set(
        next.candidate.subtype,
        (subtypeCounts.get(next.candidate.subtype) ?? 0) + 1,
      );
    }
  }

  return selected;
}

// Wraps a candidate that never went through the greedy semantic/diversity
// pass — no interest signal at all, or absent from similarityById — with an
// honest breakdown: diversityBonus is 0 because that pass never ran for it,
// not because diversity genuinely contributed nothing.
function wrapWithoutSemanticSignal<T extends RankableCandidate>(
  candidate: T,
  maximumDistanceKm: number,
): RankedCandidate<T> {
  const quality = qualityBonus(candidate);
  const proximity = proximityBonus(candidate, maximumDistanceKm);
  return {
    candidate,
    scoreBreakdown: {
      semanticSimilarity: null,
      qualityBonus: quality,
      proximityBonus: proximity,
      diversityBonus: 0,
      totalScore: quality + proximity,
    },
  };
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
): RankedCandidate<T>[] {
  const maximumDistanceKm = Math.max(
    0,
    ...candidates
      .map((candidate) => candidate.distanceKm)
      .filter((distance): distance is number => Number.isFinite(distance)),
  );

  if (!similarityById) {
    return [...candidates]
      .sort(fallbackCompare)
      .map((candidate) =>
        wrapWithoutSemanticSignal(candidate, maximumDistanceKm),
      );
  }

  const semanticallyIndexed = candidates.filter((candidate) =>
    similarityById.has(candidate.id),
  );
  const missingEmbedding = candidates.filter(
    (candidate) => !similarityById.has(candidate.id),
  );

  return [
    ...rankKnownSemanticTier(semanticallyIndexed, similarityById),
    ...missingEmbedding
      .sort(fallbackCompare)
      .map((candidate) =>
        wrapWithoutSemanticSignal(candidate, maximumDistanceKm),
      ),
  ];
}
