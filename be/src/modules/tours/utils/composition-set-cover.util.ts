import {
  CompositionCandidate,
  CompositionCandidateDecision,
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

/**
 * Composition order: the canonical preference level rank, then the
 * composition-local exploration tilt, then id. The tilt never crosses a
 * canonical level (owner, 2026-10-15).
 */
function byCompositionOrder(a: CompositionCandidate, b: CompositionCandidate) {
  return (
    a.levelRank - b.levelRank ||
    b.explorationTilt - a.explorationTilt ||
    a.id.localeCompare(b.id)
  );
}

/** Pure deterministic Stage-9 set composition. It never establishes facet truth. */
export function composeSet(input: ComposeSetInput): CompositionSelectionResult {
  const requested = new Set(input.preferenceSpec.facets.map(facetKey));
  const eligible = input.candidates
    .filter((candidate) => candidate.componentCount > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(eligible.map((candidate) => [candidate.id, candidate]));
  const selected: CompositionCandidate[] = [];
  const selectedIds = new Set<string>();
  const mustAnchorsForced: string[] = [];
  const reservedStrongExperienceIds: string[] = [];
  const reservedForFacetsById = new Map<string, string[]>();
  const unmetAnchors = unresolvedVenueMustAnchors(
    input.preferenceSpec.resolvedAnchors ?? [],
    input.resolvedVenueMustAnchorNames ?? [],
  );

  for (const id of [...new Set(input.resolvedVenueMustIds ?? [])].sort()) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    selected.push(candidate);
    selectedIds.add(id);
    mustAnchorsForced.push(id);
  }

  for (const key of requested) {
    if (selected.some((candidate) => candidate.satisfiedFacets.includes(key)))
      continue;
    const strongest = eligible
      .filter(
        (candidate) =>
          !selectedIds.has(candidate.id) &&
          candidate.satisfiedFacets.includes(key),
      )
      .sort(byCompositionOrder)[0];
    if (strongest) {
      selected.push(strongest);
      selectedIds.add(strongest.id);
      reservedStrongExperienceIds.push(strongest.id);
      const reservedFacets = reservedForFacetsById.get(strongest.id) ?? [];
      reservedFacets.push(key);
      reservedForFacetsById.set(strongest.id, reservedFacets);
    }
  }

  const target = portfolioTarget({
    baseTarget: basePortfolioTarget(
      input.preferenceSpec.trip.days,
      input.preferenceSpec.trip.pace,
    ),
    reservedStrongExperienceIds,
    resolvedMustVenueExperienceIds: mustAnchorsForced,
  });
  const remaining = eligible
    .filter((candidate) => !selectedIds.has(candidate.id))
    .sort(byCompositionOrder);
  const remainderFillIds: string[] = [];
  while (selected.length < target && remaining.length > 0) {
    const candidate = remaining.shift()!;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    remainderFillIds.push(candidate.id);
  }
  const reservoir = remaining.map((candidate) => candidate.id);
  const reservoirIds = new Set(reservoir);
  const remainderFillIdSet = new Set(remainderFillIds);
  const perFacetCoverage: Record<string, string[]> = {};
  const unmetFacets: string[] = [];
  for (const key of requested) {
    const coverage = selected
      .filter((candidate) => candidate.satisfiedFacets.includes(key))
      .map((candidate) => candidate.id);
    perFacetCoverage[key] = coverage;
    if (coverage.length === 0) unmetFacets.push(key);
  }

  const decisions: CompositionCandidateDecision[] = input.candidates
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((candidate) => {
      const isEligible = byId.has(candidate.id);
      const excludedReason = !isEligible
        ? ('no_components' as const)
        : undefined;
      return {
        id: candidate.id,
        eligible: isEligible,
        initialSelected: selectedIds.has(candidate.id),
        reservedForFacets: reservedForFacetsById.get(candidate.id) ?? [],
        mustForced: mustAnchorsForced.includes(candidate.id),
        softAnchorBoosted: candidate.softAnchor,
        remainderFill: remainderFillIdSet.has(candidate.id),
        reservoir: reservoirIds.has(candidate.id),
        excluded: !isEligible,
        ...(excludedReason ? { excludedReason } : {}),
      };
    });

  return {
    selected: selected.map((candidate) => candidate.id),
    reservoir,
    perFacetCoverage,
    unmetFacets,
    mustAnchorsForced,
    softAnchorsBoosted: eligible
      .filter((candidate) => candidate.softAnchor)
      .map((candidate) => candidate.id),
    unmetAnchors,
    portfolioTarget: target,
    decisions,
  };
}
