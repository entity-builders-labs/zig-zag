import {
  Coordinate,
  PlanningActivityCandidate,
} from '../interfaces/daily-planning.interface';
import {
  DayAccumulator,
  PlacementContext,
  checkHardConstraints,
} from './daily-planning-placement.util';
import { footprintDistanceMeters } from './spatial-footprint.util';

function dayCentroid(acc: DayAccumulator): Coordinate | null {
  if (acc.assigned.length === 0) return null;
  const lat =
    acc.assigned.reduce((sum, a) => sum + a.spatialFootprint.centroid.lat, 0) /
    acc.assigned.length;
  const lng =
    acc.assigned.reduce((sum, a) => sum + a.spatialFootprint.centroid.lng, 0) /
    acc.assigned.length;
  return { lat, lng };
}

function distanceToCentroid(
  candidate: PlanningActivityCandidate,
  centroid: Coordinate | null,
): number {
  if (!centroid) return 0;
  return footprintDistanceMeters(candidate.spatialFootprint, {
    type: 'POINT',
    centroid,
  });
}

/** Builds a hypothetical accumulator with `remove` taken out, for probing
 * `checkHardConstraints` before committing a swap. Must also subtract
 * `remove`'s own contribution to `totalActivityMinutes` (mirroring, in
 * reverse, how `placeCandidates`/`tryMove` accumulate it) — not just filter
 * `assigned`. The DAILY_TIME_CAPACITY_EXCEEDED/MAX_WALKING_PER_DAY_EXCEEDED
 * checks are pure thresholds, so a stale (too-high) total there is only ever
 * conservative. But the OPENING_HOURS_INCOMPATIBLE check reads
 * `acc.totalActivityMinutes` to compute a proposed `[start, end)` instant,
 * not a threshold — a stale, inflated total shifts that instant *later*,
 * which can move a truly before-opening instant into a falsely-evaluated
 * open window: a false ACCEPT, not a safe over-reject. `totalWalkingMeters`
 * is deliberately left as-is: unlike `totalActivityMinutes`, it isn't read
 * to resolve a point-in-time window anywhere in `checkHardConstraints`, so
 * its threshold checks stay conservative-only either way. */
function withoutCandidate(
  acc: DayAccumulator,
  remove: PlanningActivityCandidate,
): DayAccumulator {
  return {
    ...acc,
    assigned: acc.assigned.filter((a) => a.activityId !== remove.activityId),
    totalActivityMinutes:
      acc.totalActivityMinutes -
      remove.durationMinutes -
      (remove.mobility?.internalTravelMinutes ?? 0),
  };
}

/** Move: relocate one Activity from a day with meaningfully more assigned
 * Activities to a lighter day, only when hard-feasible at the destination. */
async function tryMove(
  days: Map<number, DayAccumulator>,
  context: PlacementContext,
): Promise<boolean> {
  for (const [fromDay, fromAcc] of days) {
    for (const candidate of fromAcc.assigned) {
      for (const [toDay, toAcc] of days) {
        if (toDay === fromDay) continue;
        if (toAcc.assigned.length + 1 >= fromAcc.assigned.length) continue;

        const feasibility = await checkHardConstraints(
          candidate,
          toAcc,
          context,
        );
        if (!feasibility.feasible) continue;

        fromAcc.assigned = fromAcc.assigned.filter(
          (a) => a.activityId !== candidate.activityId,
        );
        fromAcc.totalActivityMinutes -= candidate.durationMinutes;
        toAcc.assigned.push(candidate);
        toAcc.totalActivityMinutes += candidate.durationMinutes;
        return true;
      }
    }
  }
  return false;
}

/** Swap: exchange two Activities across two days when it strictly reduces
 * combined distance-to-day-centroid (geographic compactness), and both
 * resulting days stay hard-feasible. */
async function trySwap(
  days: Map<number, DayAccumulator>,
  context: PlacementContext,
): Promise<boolean> {
  const entries = Array.from(days.entries());
  for (const [dayA, accA] of entries) {
    for (const [dayB, accB] of entries) {
      if (dayB <= dayA) continue;
      for (const candidateA of accA.assigned) {
        for (const candidateB of accB.assigned) {
          const centroidA = dayCentroid(accA);
          const centroidB = dayCentroid(accB);
          const currentSpread =
            distanceToCentroid(candidateA, centroidA) +
            distanceToCentroid(candidateB, centroidB);
          const swappedSpread =
            distanceToCentroid(candidateB, centroidA) +
            distanceToCentroid(candidateA, centroidB);
          if (swappedSpread >= currentSpread) continue;

          const feasibleInA = await checkHardConstraints(
            candidateB,
            withoutCandidate(accA, candidateA),
            context,
          );
          const feasibleInB = await checkHardConstraints(
            candidateA,
            withoutCandidate(accB, candidateB),
            context,
          );
          if (!feasibleInA.feasible || !feasibleInB.feasible) continue;

          accA.assigned = accA.assigned.map((a) =>
            a.activityId === candidateA.activityId ? candidateB : a,
          );
          accB.assigned = accB.assigned.map((a) =>
            a.activityId === candidateB.activityId ? candidateA : a,
          );
          return true;
        }
      }
    }
  }
  return false;
}

/** Bounded, deterministic local improvement — no randomization, no
 * simulated annealing. Stops as soon as neither a move nor a swap improves
 * anything, or the iteration bound is reached. */
export async function runBoundedLocalImprovement(
  days: Map<number, DayAccumulator>,
  context: PlacementContext,
): Promise<{ days: Map<number, DayAccumulator>; iterations: number }> {
  let iterations = 0;
  const maxIterations = context.policy.localImprovement.maxIterations;

  while (iterations < maxIterations) {
    iterations++;
    const movedOrSwapped =
      (await tryMove(days, context)) || (await trySwap(days, context));
    if (!movedOrSwapped) break;
  }

  return { days, iterations };
}
