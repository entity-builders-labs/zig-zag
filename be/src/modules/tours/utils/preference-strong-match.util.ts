/**
 * Canonical strong/weak match helper (spec §6.1, plan Task A5).
 *
 * A "strong match" is the AND of, in order:
 * 1. `candidateMatchesPreferenceFacet` -- the one canonical matching
 *    primitive (never a second keyword/JSON engine);
 * 2. at least one resolved component with real geography;
 * 3. `qualityScore >= QUALITY_FLOOR` (policy, default 3.0/5) -- `null`
 *    quality never gets a magic default (spec §10.1), it simply fails
 *    this check and the candidate remains at most a weak match;
 * 4. classification/evidence grounding is not explicitly known-thin
 *    (absence of classification metadata is NOT proof of thinness --
 *    only an explicit `degraded` state is);
 * 5. an obvious pre-planner feasibility check only (e.g. a duration that
 *    obviously exceeds the entire planning window). The daily planner
 *    remains authoritative for full feasibility (opening hours, routing,
 *    etc.) -- this is not a substitute for Stage 10.
 *
 * A candidate that fails only steps 2-5 while still satisfying step 1 is a
 * *weak* match: still relevant for ranking/enrichment, per spec §6.1, but
 * this helper answers only the strong/not-strong question -- callers (e.g.
 * Task A6's FacetRetrievalService) derive "weak" themselves as
 * `candidateMatchesPreferenceFacet(...) && !isStrongFacetMatch(...)`.
 */
import { candidateMatchesPreferenceFacet } from './preference-facet-matching.util';
import { RequestedFacet } from '../interfaces/preference-spec.interface';
import { ExperienceMatchFacts } from '../interfaces/experience-match-facts.interface';

export const DEFAULT_QUALITY_FLOOR = 3.0;

export interface StrongMatchPolicy {
  /** Minimum qualityScore (0..5) to count as strong. Default 3.0. */
  qualityFloor?: number;
  /**
   * Total remaining planning-window minutes available for the trip, if
   * known at this stage. When provided, a candidate whose durationMinutes
   * obviously exceeds it cannot be strong. Omit when not yet known --
   * this is only an "obviously impossible" pre-planner guard, not a
   * substitute for the daily planner's own feasibility authority.
   */
  planningWindowMinutes?: number;
}

export function isStrongFacetMatch(
  facts: ExperienceMatchFacts,
  facet: RequestedFacet,
  policy: StrongMatchPolicy = {},
): boolean {
  if (!candidateMatchesPreferenceFacet(facts.semantic, facet)) {
    return false;
  }
  if (!facts.hasResolvedGeography) {
    return false;
  }
  // UNKNOWN quality never gets a magic default: it fails the floor and the
  // candidate stays at most a weak match.
  const qualityFloor = policy.qualityFloor ?? DEFAULT_QUALITY_FLOOR;
  if (facts.qualityScore === null || facts.qualityScore < qualityFloor) {
    return false;
  }
  // Only an explicit degraded classification is known-thin evidence; no
  // classification recorded yet is not.
  if (facts.classificationState === 'DEGRADED') {
    return false;
  }
  if (
    typeof policy.planningWindowMinutes === 'number' &&
    facts.durationMinutes !== null &&
    facts.durationMinutes > policy.planningWindowMinutes
  ) {
    return false;
  }
  return true;
}
