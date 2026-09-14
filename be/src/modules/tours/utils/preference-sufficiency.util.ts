/**
 * Canonical sufficiency primitives (spec §6.2, plan Task A4).
 *
 * `days x pace` is the GLOBAL portfolio-capacity target for the whole trip,
 * never a per-facet quota. A requested facet is satisfied by >=1 strong
 * match. Overall knowledge is sufficient only when every requested facet is
 * satisfied AND the total distinct eligible pool reaches the global target
 * -- three satisfied facets do not by themselves make a thin pool
 * sufficient.
 *
 * None of these helpers accepts `explorationStyle` as input (see each
 * function's arity) -- it is a meta-preference (spec §3.1) and must never
 * influence sufficiency.
 *
 * Deliberately NOT implemented here: a per-facet `requiredMatchCount(days,
 * pace)` -- that would reintroduce a per-facet quota, which this model
 * explicitly rejects.
 */
import { PreferenceSpec } from '../interfaces/preference-spec.interface';

type Pace = PreferenceSpec['trip']['pace'];

export interface PortfolioTargetFacts {
  baseTarget: number;
  reservedStrongExperienceIds: readonly string[];
  resolvedMustVenueExperienceIds: readonly string[];
}

const MIN_DAYS = 1;
const MAX_DAYS = 14;

export function paceFactor(pace: Pace): number {
  switch (pace) {
    case 'relaxed':
      return 3;
    case 'moderate':
      return 4;
    case 'fast':
      return 5;
  }
}

/**
 * `clamp(days,1,14) * paceFactor(pace)` -- the base GLOBAL portfolio
 * target for the whole trip. Never a per-facet quota.
 */
export function basePortfolioTarget(days: number, pace: Pace): number {
  const clampedDays = Math.min(Math.max(days, MIN_DAYS), MAX_DAYS);
  return clampedDays * paceFactor(pace);
}

/** `strongCount >= 1`. */
export function facetSatisfied(strongCount: number): boolean {
  return strongCount >= 1;
}

/**
 * `max(baseTarget, distinctReservations + distinctMustAnchors)` -- the
 * actual composition target is at least large enough to hold the distinct
 * facet reservations and resolved must anchors, but never less than the
 * base days x pace target.
 */
export function portfolioTarget(
  facts: PortfolioTargetFacts,
): number {
  const reservedIds = new Set([
    ...facts.reservedStrongExperienceIds,
    ...facts.resolvedMustVenueExperienceIds,
  ]);
  return Math.max(facts.baseTarget, reservedIds.size);
}
