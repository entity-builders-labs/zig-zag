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
  /** Deterministic affinity to normalized user themes/traits (0..1). */
  preferenceScore?: number;
}

// Exposes what actually drove a candidate's rank, so the generation
// bitácora can show real per-candidate score components instead of an
// opaque total.
export interface CandidateScoreBreakdown {
  /** null = missing-embedding tier; never a fake 0. */
  semanticSimilarity: number | null;
  /** Raw deterministic preference affinity before weighting. */
  preferenceScore?: number;
  /** Weighted contribution actually added to totalScore. */
  preferenceBonus?: number;
  qualityBonus: number;
  proximityBonus: number;
  /** Captured at the moment this candidate was selected. */
  diversityBonus: number;
  totalScore: number;
}

export interface RankedCandidate<T extends RankableCandidate> {
  candidate: T;
  scoreBreakdown: CandidateScoreBreakdown;
}

const MAX_WEIGHTED_SCORE = 5;
const POI_QUALITY_WEIGHT = 0.2;
const CURATED_COMPOSITE_BONUS = 0.15;
const PROXIMITY_WEIGHT = 0.1;
const NEW_KIND_BONUS = 0.04;
const NEW_SUBTYPE_BONUS = 0.03;
const REPEATED_SUBTYPE_PENALTY = 0.02;
export const PREFERENCE_WEIGHT = 0.25;

export function qualityBonus(candidate: RankableCandidate): number {
  if (candidate.source === 'poi') {
    return (
      ((candidate.weightedScore ?? 0) / MAX_WEIGHTED_SCORE) * POI_QUALITY_WEIGHT
    );
  }
  return candidate.isCurated ? CURATED_COMPOSITE_BONUS : 0;
}

export function preferenceBonus(candidate: RankableCandidate): number {
  return (candidate.preferenceScore ?? 0) * PREFERENCE_WEIGHT;
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

function preferenceCompare(a: RankableCandidate, b: RankableCandidate): number {
  const preferenceDifference =
    (b.preferenceScore ?? 0) - (a.preferenceScore ?? 0);
  return Math.abs(preferenceDifference) > Number.EPSILON
    ? preferenceDifference
    : 0;
}

function fallbackCompare(a: RankableCandidate, b: RankableCandidate): number {
  const preferenceDifference = preferenceCompare(a, b);
  if (preferenceDifference !== 0) return preferenceDifference;
  const qualityDifference = qualityBonus(b) - qualityBonus(a);
  if (Math.abs(qualityDifference) > Number.EPSILON) return qualityDifference;

  const distanceDifference =
    (a.distanceKm ?? Number.POSITIVE_INFINITY) -
    (b.distanceKm ?? Number.POSITIVE_INFINITY);
  if (Math.abs(distanceDifference) > Number.EPSILON) return distanceDifference;
  return a.id.localeCompare(b.id);
}

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
  const remaining = candidates.map((candidate) => {
    const preference = preferenceBonus(candidate);
    const quality = qualityBonus(candidate);
    const proximity = proximityBonus(candidate, maximumDistanceKm);
    const semanticSimilarity = similarityById.get(candidate.id)!;
    return {
      candidate,
      semanticSimilarity,
      preference,
      quality,
      proximity,
      baseScore: semanticSimilarity + preference + quality + proximity,
    };
  });
  const selected: RankedCandidate<T>[] = [];
  const selectedKinds = new Set<string>();
  const subtypeCounts = new Map<string, number>();

  while (remaining.length > 0) {
    remaining.sort((a, b) => {
      // Explicit normalized preference affinity is a relevance tier, not a
      // small bonus that quality/diversity may override. This prevents a
      // partially matching high-rated candidate from displacing a candidate
      // that satisfies every requested facet. Semantic/quality/proximity and
      // diversity still order candidates *within* the same preference tier.
      const preferenceDifference = preferenceCompare(a.candidate, b.candidate);
      if (preferenceDifference !== 0) return preferenceDifference;

      const score = (entry: (typeof remaining)[number]) =>
        entry.baseScore +
        diversityBonusFor(entry.candidate, selectedKinds, subtypeCounts);
      const scoreDifference = score(b) - score(a);
      if (Math.abs(scoreDifference) > Number.EPSILON) return scoreDifference;
      return fallbackCompare(a.candidate, b.candidate);
    });

    const next = remaining.shift()!;
    const diversityBonus = diversityBonusFor(
      next.candidate,
      selectedKinds,
      subtypeCounts,
    );
    selected.push({
      candidate: next.candidate,
      scoreBreakdown: {
        semanticSimilarity: next.semanticSimilarity,
        preferenceScore: next.candidate.preferenceScore,
        preferenceBonus: next.preference,
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

function wrapWithoutSemanticSignal<T extends RankableCandidate>(
  candidate: T,
  maximumDistanceKm: number,
): RankedCandidate<T> {
  const preference = preferenceBonus(candidate);
  const quality = qualityBonus(candidate);
  const proximity = proximityBonus(candidate, maximumDistanceKm);
  return {
    candidate,
    scoreBreakdown: {
      semanticSimilarity: null,
      preferenceScore: candidate.preferenceScore,
      preferenceBonus: preference,
      qualityBonus: quality,
      proximityBonus: proximity,
      diversityBonus: 0,
      totalScore: preference + quality + proximity,
    },
  };
}

/**
 * Sorts candidates descending by relevance. Candidates absent from
 * similarityById have unknown semantic relevance and are ranked
 * deterministically by non-semantic signals after the compatible indexed tier.
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
