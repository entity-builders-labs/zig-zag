import { SpatialFootprint } from 'src/modules/tours/interfaces/daily-planning.interface';

/**
 * A point-shaped planning candidate's `startFootprint` / `endFootprint` both
 * collapse to its single `spatialFootprint` — exactly what
 * `PlanningCandidateNormalizerService` derives for a candidate with fewer than
 * two component footprints. Test fixtures/builders that only model point
 * Experiences use this so they stay in sync with the interface without
 * repeating the derivation.
 */
export function withPointFootprints<
  T extends { spatialFootprint: SpatialFootprint },
>(
  candidate: T,
): T & { startFootprint: SpatialFootprint; endFootprint: SpatialFootprint } {
  return {
    ...candidate,
    startFootprint: candidate.spatialFootprint,
    endFootprint: candidate.spatialFootprint,
  };
}
