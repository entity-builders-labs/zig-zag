import {
  CompositionCandidate,
  CompositionSelectionResult,
  PreferenceSpec,
  facetKey,
} from '../interfaces/preference-spec.interface';
import {
  basePortfolioTarget,
  portfolioTarget,
} from './preference-sufficiency.util';
import { unresolvedVenueMustAnchors } from './must-anchor-placement.util';

export interface ComposeSetInput {
  candidates: CompositionCandidate[];
  preferenceSpec: PreferenceSpec;
  /** Only canonical resolved venue identities may enter here. */
  resolvedVenueMustIds?: string[];
  resolvedVenueMustAnchorNames?: string[];
}

const numeric = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : -Infinity;

function byFacetPriority(
  facetWeight: number,
  a: CompositionCandidate,
  b: CompositionCandidate,
) {
  // The facet's weight is constant within this reservation. It remains part
  // of the outer requested-facet ordering, not a fabricated per-candidate
  // bonus here.
  void facetWeight;
  return (
    numeric(b.groundingStrength) - numeric(a.groundingStrength) ||
    numeric(b.semanticSimilarity) - numeric(a.semanticSimilarity) ||
    numeric(b.qualityScore) - numeric(a.qualityScore) ||
    numeric(b.explorationTilt) - numeric(a.explorationTilt) ||
    numeric(b.softAnchorBoost) - numeric(a.softAnchorBoost) ||
    a.id.localeCompare(b.id)
  );
}

function coverageWeight(
  candidate: CompositionCandidate,
  weights: Map<string, number>,
) {
  return candidate.satisfiedFacets.reduce(
    (sum, key) => sum + (weights.get(key) ?? 0),
    0,
  );
}

function byRemainderPriority(
  weights: Map<string, number>,
  a: CompositionCandidate,
  b: CompositionCandidate,
) {
  return (
    coverageWeight(b, weights) - coverageWeight(a, weights) ||
    numeric(b.semanticSimilarity) - numeric(a.semanticSimilarity) ||
    numeric(b.qualityScore) - numeric(a.qualityScore) ||
    numeric(b.explorationTilt) - numeric(a.explorationTilt) ||
    numeric(b.softAnchorBoost) - numeric(a.softAnchorBoost) ||
    a.id.localeCompare(b.id)
  );
}

/** Pure deterministic Stage-9 set composition. It never establishes facet truth. */
export function composeSet(input: ComposeSetInput): CompositionSelectionResult {
  const requested = new Map(
    input.preferenceSpec.facets.map((facet) => [facetKey(facet), facet]),
  );
  const weights = new Map(
    [...requested].map(([key, facet]) => [key, facet.weight]),
  );
  const eligible = input.candidates
    .filter(
      (candidate) =>
        !candidate.matchesHardExclusion && candidate.componentCount > 0,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(eligible.map((candidate) => [candidate.id, candidate]));
  const selected: CompositionCandidate[] = [];
  const selectedIds = new Set<string>();
  const mustAnchorsForced: string[] = [];
  const unmetAnchors = unresolvedVenueMustAnchors(
    input.preferenceSpec.anchors,
    input.resolvedVenueMustAnchorNames ?? [],
  );

  for (const id of [...new Set(input.resolvedVenueMustIds ?? [])].sort()) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    selected.push(candidate);
    selectedIds.add(id);
    mustAnchorsForced.push(id);
  }

  for (const [key, facet] of requested) {
    if (selected.some((candidate) => candidate.satisfiedFacets.includes(key)))
      continue;
    const strongest = eligible
      .filter(
        (candidate) =>
          !selectedIds.has(candidate.id) &&
          candidate.satisfiedFacets.includes(key),
      )
      .sort((a, b) => byFacetPriority(facet.weight, a, b))[0];
    if (strongest) {
      selected.push(strongest);
      selectedIds.add(strongest.id);
    }
  }

  const target = portfolioTarget(
    basePortfolioTarget(
      input.preferenceSpec.trip.days,
      input.preferenceSpec.trip.pace,
    ),
    selected.filter((candidate) => candidate.satisfiedFacets.length > 0).length,
    mustAnchorsForced.length,
  );
  const remaining = eligible
    .filter((candidate) => !selectedIds.has(candidate.id))
    .sort((a, b) => byRemainderPriority(weights, a, b));
  while (selected.length < target && remaining.length > 0) {
    const candidate = remaining.shift()!;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }
  const reservoir = remaining.map((candidate) => candidate.id);
  const perFacetCoverage: Record<string, string[]> = {};
  const unmetFacets: string[] = [];
  for (const key of requested.keys()) {
    const coverage = selected
      .filter((candidate) => candidate.satisfiedFacets.includes(key))
      .map((candidate) => candidate.id);
    perFacetCoverage[key] = coverage;
    if (coverage.length === 0) unmetFacets.push(key);
  }
  return {
    selected: selected.map((candidate) => candidate.id),
    reservoir,
    perFacetCoverage,
    unmetFacets,
    mustAnchorsForced,
    softAnchorsBoosted: eligible
      .filter((candidate) => candidate.softAnchorBoost > 0)
      .map((candidate) => candidate.id),
    unmetAnchors,
    portfolioTarget: target,
  };
}
