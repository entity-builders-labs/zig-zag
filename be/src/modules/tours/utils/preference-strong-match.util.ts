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

/**
 * `NaN`/`Infinity` satisfy `typeof value === 'number'`, so a valid
 * geographic component requires `Number.isFinite` plus real-world range,
 * not just the JS `number` type.
 */
function isValidLatitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

function isValidLongitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
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
      isValidLatitude(geoEntity.latitude) &&
      isValidLongitude(geoEntity.longitude)
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
 * Exported so other canonical-matching callers (e.g. Task A6's
 * `FacetRetrievalService`, deriving a "weak" verdict as
 * `candidateMatchesPreferenceFacet(...) && !isStrongFacetMatch(...)`) reuse
 * this one adapter instead of duplicating it.
 */
export function requestedFacetToPreferenceFacet(
  facet: RequestedFacet,
): PreferenceFacet {
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
  if (
    !candidateMatchesPreferenceFacet(
      experience,
      requestedFacetToPreferenceFacet(facet),
    )
  ) {
    return false;
  }

  // candidateMatchesPreferenceFacet already rejected non-object/null
  // experiences, so this is a plain narrowing, not a second validity gate.
  const exp = experience as Record<string, any>;

  if (!hasResolvedComponentWithGeography(exp)) {
    return false;
  }

  const qualityFloor = policy.qualityFloor ?? DEFAULT_QUALITY_FLOOR;
  const quality = exp.qualityScore;
  // NaN/Infinity satisfy `typeof quality === 'number'`, so require
  // Number.isFinite plus the canonical 0..5 scale before comparing against
  // the floor -- an invalid numeric value is rejected here for a different
  // reason than a valid-but-low score, even though both yield `false`.
  if (
    typeof quality !== 'number' ||
    !Number.isFinite(quality) ||
    quality < 0 ||
    quality > 5 ||
    quality < qualityFloor
  ) {
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

function normalizedFacetIdentity(facet: RequestedFacet): string {
  return `${facet.dimension.trim().toLowerCase()}:${facet.key
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()}`;
}

/**
 * Canonical planner preference contribution. A facet contributes only when
 * the same strong-match policy used by composition accepts it. Duplicate
 * normalized representations are counted once.
 */
export function preferenceWeightForExperience(
  experience: unknown,
  facets: readonly RequestedFacet[],
): number {
  const seen = new Set<string>();
  let weight = 0;
  for (const facet of facets) {
    const identity = normalizedFacetIdentity(facet);
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (isStrongFacetMatch(experience, facet)) weight += facet.weight;
  }
  return weight;
}
