import {
  Coordinate,
  PlanningExperienceCandidate,
} from '../interfaces/daily-planning.interface';
import {
  DayAccumulator,
  PlacementContext,
  candidateExperienceMinutes,
  checkHardConstraints,
} from './daily-planning-placement.util';
import { internalWalkingMeters } from './daily-planning-walking-feasibility.util';
import { footprintDistanceMeters } from './spatial-footprint.util';

const candidateIdentity = (candidate: PlanningExperienceCandidate): string =>
  candidate.experienceId;

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
  candidate: PlanningExperienceCandidate,
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
 * `remove`'s own contribution to `totalExperienceMinutes` (mirroring, in
 * reverse, how `placeCandidates`/`tryMove` accumulate it) — not just filter
 * `assigned`. The DAILY_TIME_CAPACITY_EXCEEDED/MAX_WALKING_PER_DAY_EXCEEDED
 * checks are pure thresholds, so a stale (too-high) total there is only ever
 * conservative. But the OPENING_HOURS_INCOMPATIBLE check reads
 * `acc.totalExperienceMinutes` to compute a proposed `[start, end)` instant,
 * not a threshold — a stale, inflated total shifts that instant *later*,
 * which can move a truly before-opening instant into a falsely-evaluated
 * open window: a false ACCEPT, not a safe over-reject. `totalWalkingMeters`
 * is deliberately left as-is: unlike `totalExperienceMinutes`, it isn't read
 * to resolve a point-in-time window anywhere in `checkHardConstraints`, so
 * its threshold checks stay conservative-only either way. */
function withoutCandidate(
  acc: DayAccumulator,
  remove: PlanningExperienceCandidate,
): DayAccumulator {
  return {
    ...acc,
    assigned: acc.assigned.filter(
      (a) => candidateIdentity(a) !== candidateIdentity(remove),
    ),
    totalExperienceMinutes:
      acc.totalExperienceMinutes - candidateExperienceMinutes(remove),
  };
}

/** Inter-Experience leg cost (travel minutes, leg walking distance) is a
 * property of a *pair* of consecutive stops, not of a candidate, so neither
 * move nor swap can re-price it without re-running the whole day's travel
 * chain. Both operations therefore adjust only the candidate-owned part of a
 * day's totals (duration + internal travel, internal walking) and leave the
 * accumulated leg contribution in place. Deliberate: keeping the stale leg
 * term over-counts slightly, which is the conservative direction for the
 * capacity/walking thresholds, whereas recomputing the totals from `assigned`
 * alone would silently DISCARD every leg the placement pass had already
 * charged and bias the day low — the unsafe direction. Residual leg-level
 * imprecision after reordering is a known, separately-tracked V1 limitation
 * (the ordering pass recomputes real per-leg values for the persisted plan). */
function transferCandidateTotals(
  from: DayAccumulator,
  to: DayAccumulator,
  candidate: PlanningExperienceCandidate,
  context: PlacementContext,
): void {
  const minutes = candidateExperienceMinutes(candidate);
  const walkingMeters = internalWalkingMeters(candidate, context.policy);
  from.totalExperienceMinutes -= minutes;
  to.totalExperienceMinutes += minutes;
  from.totalWalkingMeters -= walkingMeters;
  to.totalWalkingMeters += walkingMeters;
}

/** Move: relocate one Experience from a day with meaningfully more assigned
 * Activities to a lighter day, only when hard-feasible at the destination. */
async function tryMove(
  days: Map<number, DayAccumulator>,
  context: PlacementContext,
): Promise<boolean> {
  for (const [fromDay, fromAcc] of days) {
    for (const candidate of fromAcc.assigned) {
      if (candidate.mustInclude === true) continue;
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
          (a) => candidateIdentity(a) !== candidateIdentity(candidate),
        );
        toAcc.assigned.push(candidate);
        // Must mirror exactly what `placeCandidates` charged for this
        // candidate — duration AND its internal travel. Subtracting only
        // `durationMinutes` left the source day's total drifting low by the
        // omitted internal travel on every move, so later iterations probed
        // `checkHardConstraints` against a day that looked emptier than it
        // was (a false ACCEPT of a placement that actually overflows).
        transferCandidateTotals(fromAcc, toAcc, candidate, context);
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
          if (
            candidateA.mustInclude === true ||
            candidateB.mustInclude === true
          )
            continue;
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
            candidateIdentity(a) === candidateIdentity(candidateA)
              ? candidateB
              : a,
          );
          accB.assigned = accB.assigned.map((a) =>
            candidateIdentity(a) === candidateIdentity(candidateB)
              ? candidateA
              : a,
          );
          // The swap previously left both days' totals describing their
          // pre-swap composition — exchanging a 60-minute stop for a
          // 180-minute one silently kept the old numbers, and every later
          // iteration then evaluated hard constraints against a fictional
          // baseline. Re-price both days by transferring each candidate's own
          // contribution to the day that now holds it.
          transferCandidateTotals(accA, accB, candidateA, context);
          transferCandidateTotals(accB, accA, candidateB, context);
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
