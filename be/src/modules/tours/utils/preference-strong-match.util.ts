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
import { PreferenceFacet } from '../preferences/preference-facet.interface';
import { RequestedFacet } from '../interfaces/preference-spec.interface';

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

function hasResolvedComponentWithGeography(exp: Record<string, any>): boolean {
  const components = Array.isArray(exp.components) ? exp.components : [];
  return components.some((component: any) => {
    if (!component || typeof component !== 'object') {
      return false;
    }
    const geoEntity = component.geoEntity;
    return (
      geoEntity &&
      typeof geoEntity === 'object' &&
      typeof geoEntity.latitude === 'number' &&
      typeof geoEntity.longitude === 'number'
    );
  });
}

function isClassificationKnownThin(exp: Record<string, any>): boolean {
  const metadata =
    exp.metadata && typeof exp.metadata === 'object' ? exp.metadata : {};
  const classification = metadata.classification;
  if (!classification || typeof classification !== 'object') {
    // No classification recorded yet is not the same as known-thin
    // evidence -- only an explicit 'degraded' state disqualifies.
    return false;
  }
  return classification.state === 'degraded';
}

/**
 * Adapts a `RequestedFacet` (Task A1) to the `PreferenceFacet` shape
 * `candidateMatchesPreferenceFacet` expects. Only `dimension`/`key` are
 * ever read by that primitive; `importance`/`confidence` are filled with
 * neutral values purely to satisfy the type, never used for matching.
 */
function toPreferenceFacet(facet: RequestedFacet): PreferenceFacet {
  return {
    dimension: facet.dimension,
    key: facet.key,
    importance: 1,
    confidence: 1,
    source: facet.source,
  };
}

export function isStrongFacetMatch(
  experience: unknown,
  facet: RequestedFacet,
  policy: StrongMatchPolicy = {},
): boolean {
  if (!candidateMatchesPreferenceFacet(experience, toPreferenceFacet(facet))) {
    return false;
  }

  // candidateMatchesPreferenceFacet already rejected non-object/null
  // experiences, so this is a plain narrowing, not a second validity gate.
  const exp = experience as Record<string, any>;

  if (!hasResolvedComponentWithGeography(exp)) {
    return false;
  }

  const qualityFloor = policy.qualityFloor ?? DEFAULT_QUALITY_FLOOR;
  if (typeof exp.qualityScore !== 'number' || exp.qualityScore < qualityFloor) {
    return false;
  }

  if (isClassificationKnownThin(exp)) {
    return false;
  }

  if (
    typeof policy.planningWindowMinutes === 'number' &&
    typeof exp.durationMinutes === 'number' &&
    exp.durationMinutes > policy.planningWindowMinutes
  ) {
    return false;
  }

  return true;
}
