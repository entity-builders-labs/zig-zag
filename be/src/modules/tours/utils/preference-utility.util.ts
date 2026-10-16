import {
  ComposableExperience,
  PreferenceSpec,
  facetKey,
} from '../interfaces/preference-spec.interface';
import {
  GenericQuality,
  PREFERENCE_UTILITY_POLICY_VERSION,
  PreferenceUtilityAssessment,
  PreferenceUtilityBreakdown,
  PreferenceUtilityResult,
  SemanticAffinity,
} from '../interfaces/preference-utility.interface';
import { semanticTargetKey } from '../preferences/preference-assertion.interface';
import { candidateMatchesPreferenceFacet } from './preference-facet-matching.util';
import { isStrongFacetMatch } from './preference-strong-match.util';
import { SemanticSimilarityResult } from '@shared/ai/interfaces/embedding-index.interface';

/**
 * Sums of importance (× confidence) are compared with this tolerance so that
 * floating-point noise (0.7 + 0.5 vs 1.2) never splits one level.
 */
const LEVEL_EPSILON = 1e-9;

export interface PreferenceUtilityInput {
  experiences: readonly ComposableExperience[];
  preferenceSpec: Pick<PreferenceSpec, 'facets' | 'assertions'>;
  softAnchorIds: ReadonlySet<string>;
  /** null when the request has no semantic query. */
  semantic: SemanticSimilarityResult | null;
}

function semanticAffinity(
  id: string,
  semantic: SemanticSimilarityResult | null,
): SemanticAffinity {
  if (!semantic) return { status: 'UNKNOWN', reason: 'EMPTY_QUERY' };
  if (semantic.status !== 'applied') {
    return { status: 'UNKNOWN', reason: 'PROVIDER_UNAVAILABLE' };
  }
  const similarity = semantic.scores.get(id);
  return typeof similarity === 'number' && Number.isFinite(similarity)
    ? { status: 'KNOWN', similarity }
    : { status: 'UNKNOWN', reason: 'NO_COMPATIBLE_EMBEDDING' };
}

function genericQuality(experience: ComposableExperience): GenericQuality {
  const score = experience.qualityScore;
  return typeof score === 'number' &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 5
    ? { status: 'KNOWN', score }
    : { status: 'UNKNOWN', reason: 'NO_QUALITY_SIGNAL' };
}

function assess(
  experience: ComposableExperience,
  input: PreferenceUtilityInput,
): Omit<PreferenceUtilityAssessment, 'rank' | 'levelRank'> {
  let directEvidence = 0;
  let inferredEvidence = 0;
  const matchedFacets: string[] = [];
  for (const facet of input.preferenceSpec.facets) {
    if (!isStrongFacetMatch(experience, facet)) continue;
    matchedFacets.push(facetKey(facet));
    if (facet.provenance === 'DIRECT') directEvidence += facet.importance;
    else inferredEvidence += facet.importance * facet.confidence;
  }

  let directConflict = 0;
  let inferredConflict = 0;
  const avoidedTargets: string[] = [];
  for (const assertion of input.preferenceSpec.assertions) {
    if (assertion.polarity !== 'EXCLUDE' || assertion.constraint !== 'SOFT') {
      continue;
    }
    // A confirmed typed fact only; an absent fact is neutral.
    if (!candidateMatchesPreferenceFacet(experience, assertion.target)) {
      continue;
    }
    avoidedTargets.push(semanticTargetKey(assertion.target));
    if (assertion.provenance === 'DIRECT') {
      directConflict += assertion.importance;
    } else {
      inferredConflict += assertion.importance * assertion.confidence;
    }
  }

  const breakdown: PreferenceUtilityBreakdown = {
    directEvidence,
    inferredEvidence,
    avoidance: { directConflict, inferredConflict },
    softAnchor: input.softAnchorIds.has(experience.id),
    semantic: semanticAffinity(experience.id, input.semantic),
    quality: genericQuality(experience),
  };
  return {
    experienceId: experience.id,
    breakdown,
    matchedFacets,
    avoidedTargets,
  };
}

/** Rounded identity of levels 1–4, the tier used for UNKNOWN medians. */
function tierKey(breakdown: PreferenceUtilityBreakdown): string {
  const round = (value: number) => value.toFixed(9);
  return [
    round(breakdown.directEvidence),
    round(breakdown.inferredEvidence),
    round(breakdown.avoidance.directConflict),
    round(breakdown.avoidance.inferredConflict),
    breakdown.softAnchor ? '1' : '0',
  ].join('|');
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Positive when `a` belongs before `b` by a higher-is-better value. */
function descending(a: number, b: number): number {
  return Math.abs(a - b) <= LEVEL_EPSILON ? 0 : b - a;
}

/**
 * The canonical comparison of explicit preference (levels 1–3: DIRECT
 * evidence, INFERRED evidence, soft-exclusion avoidance). Negative when `x`
 * is preferred. The single implementation of these levels; consumers that
 * need only explicit preference (overlap resolution) reuse it.
 */
export function compareExplicitPreference(
  x: PreferenceUtilityBreakdown,
  y: PreferenceUtilityBreakdown,
): number {
  return (
    descending(x.directEvidence, y.directEvidence) ||
    descending(x.inferredEvidence, y.inferredEvidence) ||
    descending(-x.avoidance.directConflict, -y.avoidance.directConflict) ||
    descending(-x.avoidance.inferredConflict, -y.avoidance.inferredConflict)
  );
}

/**
 * Derives the canonical preference utility of every Experience once: the
 * typed breakdown, the canonical order and both ranks. Pure and
 * deterministic; it never reads input order.
 */
export function derivePreferenceUtility(
  input: PreferenceUtilityInput,
): Omit<PreferenceUtilityResult, 'semanticRanking'> {
  const assessed = [
    ...new Map(input.experiences.map((e) => [e.id, e])).values(),
  ].map((experience) => assess(experience, input));

  // Ordering projections for UNKNOWN semantic / quality: the median of KNOWN
  // peers in the same levels-1..4 tier; a tier with no KNOWN value skips the
  // level (every member projects to the same key).
  const tiers = new Map<string, typeof assessed>();
  for (const item of assessed) {
    const key = tierKey(item.breakdown);
    tiers.set(key, [...(tiers.get(key) ?? []), item]);
  }
  const semanticKey = new Map<string, number>();
  const qualityKey = new Map<string, number>();
  for (const members of tiers.values()) {
    const semanticMedian = median(
      members.flatMap(({ breakdown }) =>
        breakdown.semantic.status === 'KNOWN'
          ? [breakdown.semantic.similarity]
          : [],
      ),
    );
    const qualityMedian = median(
      members.flatMap(({ breakdown }) =>
        breakdown.quality.status === 'KNOWN' ? [breakdown.quality.score] : [],
      ),
    );
    for (const { experienceId, breakdown } of members) {
      semanticKey.set(
        experienceId,
        breakdown.semantic.status === 'KNOWN'
          ? breakdown.semantic.similarity
          : (semanticMedian ?? 0),
      );
      qualityKey.set(
        experienceId,
        breakdown.quality.status === 'KNOWN'
          ? breakdown.quality.score
          : (qualityMedian ?? 0),
      );
    }
  }

  const compareLevels = (
    a: (typeof assessed)[number],
    b: (typeof assessed)[number],
  ): number => {
    const x = a.breakdown;
    const y = b.breakdown;
    return (
      compareExplicitPreference(x, y) ||
      descending(Number(x.softAnchor), Number(y.softAnchor)) ||
      descending(
        semanticKey.get(a.experienceId)!,
        semanticKey.get(b.experienceId)!,
      ) ||
      descending(
        qualityKey.get(a.experienceId)!,
        qualityKey.get(b.experienceId)!,
      )
    );
  };

  const ordered = [...assessed].sort(
    (a, b) =>
      compareLevels(a, b) || a.experienceId.localeCompare(b.experienceId),
  );
  const byId = new Map<string, PreferenceUtilityAssessment>();
  let levelRank = 0;
  ordered.forEach((item, index) => {
    if (index === 0 || compareLevels(ordered[index - 1], item) !== 0) {
      levelRank += 1;
    }
    byId.set(item.experienceId, { ...item, rank: index + 1, levelRank });
  });
  return {
    policyVersion: PREFERENCE_UTILITY_POLICY_VERSION,
    order: ordered.map((item) => item.experienceId),
    byId,
  };
}
