import {
  DailyPlanningWindow,
  PlanningExperienceCandidate,
  PlanningRejectionReason,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import {
  MobilityPreferences,
  TransportationMode,
} from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';
import { isOpenDuring } from './normalized-opening-hours.util';

const candidateIdentity = (candidate: PlanningExperienceCandidate): string =>
  candidate.experienceId;

export interface DayAccumulator {
  dayNumber: number;
  assigned: PlanningExperienceCandidate[];
  totalExperienceMinutes: number;
  totalWalkingMeters: number;
}

export interface PlacementContext {
  policy: DailyPlanningPolicy;
  mobility: MobilityPreferences;
  planningWindow: DailyPlanningWindow;
  travelEstimateProvider: TravelEstimateProvider;
  /** ISO date strings — empty means no confirmed base date, so weekday-
   * specific opening-hours checks are skipped rather than guessed. */
  startDates: string[];
}

/** Resolves the JS weekday (0=Sun..6=Sat) for a given planning day number,
 * from the tour's first confirmed start date. Exported so the ordering pass
 * resolves the weekday exactly the same way instead of reimplementing it.
 * Deliberately parses the
 * `YYYY-MM-DD` components and constructs the Date with the local-time
 * constructor (`new Date(y, m, d)`) rather than `new Date(dateOnlyString)` —
 * a date-only ISO string parses as UTC midnight, while `Date#getDay()`
 * reads the *local* calendar day, so on any host west of UTC that pairing
 * silently reports the previous day's weekday. Adding `dayNumber - 1` days
 * via the constructor's day argument lets JS normalize month/year rollover
 * for multi-day tours for free. */
export function resolveWeekday(
  startDates: string[],
  dayNumber: number,
): number | undefined {
  if (startDates.length === 0) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDates[0]);
  if (!match) return undefined;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const target = new Date(year, month - 1, day + (dayNumber - 1));
  if (Number.isNaN(target.getTime())) return undefined;
  return target.getDay();
}

/** A candidate's own contribution to a day's `totalExperienceMinutes`: its
 * duration plus whatever internal travel it carries (a composite's own
 * waypoint-to-waypoint time). Deliberately excludes inter-experience leg
 * travel, which depends on which stop precedes it and is therefore not a
 * property of the candidate alone. Exported so Task 9's local improvement
 * adds/removes exactly what `placeCandidates` accumulated, instead of
 * re-deriving a partial formula that silently drifts. */
export function candidateExperienceMinutes(
  candidate: PlanningExperienceCandidate,
): number {
  return (
    candidate.durationMinutes + (candidate.mobility?.internalTravelMinutes ?? 0)
  );
}

export function internalWalkingMeters(
  candidate: PlanningExperienceCandidate,
  policy: DailyPlanningPolicy,
): number {
  if (candidate.mobility?.internalWalkingDistanceMeters !== undefined) {
    return candidate.mobility.internalWalkingDistanceMeters;
  }
  if (
    candidate.mobility?.internalWalkingDistanceMeters === undefined &&
    candidate.mobility?.internalWalkingMinutes === undefined
  ) {
    // A point Experience has no internal leg. For an area/line Experience,
    // unknown internal walking gets the explicit conservative fallback.
    if (candidate.spatialFootprint.type === 'POINT') return 0;
    return (
      (policy.internalWalking.unknownFallbackMinutes *
        policy.travel.walkingSpeedKmh *
        1000) /
      60
    );
  }
  return 0;
}

/** Pure read of (candidate, acc, context) — never mutates `acc`. Safe to
 * call both from the main placement loop (which appends afterward) and from
 * Task 9's local improvement (which probes a hypothetical day state without
 * ever appending). */
export async function checkHardConstraints(
  candidate: PlanningExperienceCandidate,
  acc: DayAccumulator,
  context: PlacementContext,
): Promise<{ feasible: boolean; reasons: PlanningRejectionReason[] }> {
  const reasons: PlanningRejectionReason[] = [];

  // `Number.isFinite` rejects null, undefined, NaN and Infinity in one check
  // and accepts every legitimate coordinate. `null` matters specifically:
  // `Experience latitude`/`longitude` are Prisma `Float?`, so a missing value
  // arrives as `null`, which passes both an `=== undefined` and an isNaN
  // check and is then silently coerced to 0 by the Haversine math — planning
  // a real candidate at Null Island (0N 0E).
  if (
    !Number.isFinite(candidate.spatialFootprint.centroid.lat) ||
    !Number.isFinite(candidate.spatialFootprint.centroid.lng)
  ) {
    return { feasible: false, reasons: ['INVALID_SPATIAL_FOOTPRINT'] };
  }

  const previous = acc.assigned[acc.assigned.length - 1];
  const travel = previous
    ? await context.travelEstimateProvider.estimate(
        previous.spatialFootprint,
        candidate.spatialFootprint,
        context.mobility.allowedTransportationModes,
      )
    : null;

  if (
    travel &&
    !context.mobility.allowedTransportationModes.includes(travel.mode)
  ) {
    reasons.push('NO_ALLOWED_TRAVEL_MODE');
  }

  const dayWindowMinutes =
    context.planningWindow.endMinutesFromMidnight -
    context.planningWindow.startMinutesFromMidnight;
  const projectedExperienceMinutes =
    acc.totalExperienceMinutes +
    candidateExperienceMinutes(candidate) +
    (travel?.durationMinutes ?? 0);
  if (projectedExperienceMinutes > dayWindowMinutes) {
    reasons.push('DAILY_TIME_CAPACITY_EXCEEDED');
  }

  const legWalkingMeters = travel?.walkingDistanceMeters ?? 0;
  const candidateInternalWalkingMeters = internalWalkingMeters(
    candidate,
    context.policy,
  );
  const projectedWalkingMeters =
    acc.totalWalkingMeters + candidateInternalWalkingMeters + legWalkingMeters;
  if (
    context.mobility.allowedTransportationModes.includes(
      TransportationMode.WALKING,
    ) &&
    projectedWalkingMeters > context.mobility.maxWalkingDistancePerDayMeters
  ) {
    reasons.push('MAX_WALKING_PER_DAY_EXCEEDED');
  }
  // V1 treats one inter-experience leg as one continuous segment (documented
  // approximation — see the plan's "internal walking, reconciled" section).
  if (legWalkingMeters > context.mobility.maxContinuousWalkingDistanceMeters) {
    reasons.push('MAX_CONTINUOUS_WALKING_EXCEEDED');
  }

  if (candidate.openingHours) {
    const weekday = resolveWeekday(context.startDates, acc.dayNumber);
    if (weekday !== undefined) {
      const proposedStart =
        context.planningWindow.startMinutesFromMidnight +
        acc.totalExperienceMinutes;
      const proposedEnd = proposedStart + candidate.durationMinutes;
      if (
        !isOpenDuring(
          candidate.openingHours,
          weekday,
          proposedStart,
          proposedEnd,
        )
      ) {
        reasons.push('OPENING_HOURS_INCOMPATIBLE');
      }
    }
    // No confirmed base date: cannot evaluate a weekday-specific window —
    // treated as unknown, same policy as missing opening-hours data.
  }

  return { feasible: reasons.length === 0, reasons };
}

/** Soft score for placing `candidate` into day `acc`. Deliberately narrow:
 * semantic relevance, quality, requested-format match, day-balance, and
 * same-day family-variant redundancy only. Travel cost, geographic spread,
 * and cross-day redundancy are intentionally NOT scored here — they are
 * Task 9 local-improvement concerns, evaluated only after a full day's
 * candidates are known. */
export function scoreCandidateForDay(
  candidate: PlanningExperienceCandidate,
  acc: DayAccumulator,
  context: PlacementContext,
): number {
  const { scoring } = context.policy;
  const semantic = scoring.semanticWeight * candidate.semanticScore;
  // Unknown quality contributes 0, never a penalty relative to an explicit 0.
  const quality = scoring.qualityWeight * (candidate.qualityScore ?? 0);
  const dayBalanceBonus =
    scoring.dayBalanceWeight * (1 / (acc.assigned.length + 1));
  return semantic + quality + dayBalanceBonus;
}

/** Greedy day placement: for each candidate (already sorted by the caller),
 * finds every hard-feasible day and assigns it to whichever scores highest.
 * Duplicate experienceIds and a `requestedDays` of 0 are handled here, at the
 * placement-loop layer — not inside `checkHardConstraints`, which only ever
 * evaluates one candidate against one day's state. */
export async function placeCandidates(
  sortedCandidates: PlanningExperienceCandidate[],
  requestedDays: number,
  context: PlacementContext,
): Promise<{
  days: Map<number, DayAccumulator>;
  unselected: UnselectedPlanningCandidate[];
}> {
  const days = new Map<number, DayAccumulator>();
  for (let d = 1; d <= requestedDays; d++) {
    days.set(d, {
      dayNumber: d,
      assigned: [],
      totalExperienceMinutes: 0,
      totalWalkingMeters: 0,
    });
  }

  const placedIds = new Set<string>();
  const unselected: UnselectedPlanningCandidate[] = [];

  for (const candidate of sortedCandidates) {
    if (placedIds.has(candidateIdentity(candidate))) {
      unselected.push({
        experienceId: candidate.experienceId,
        reasons: ['DUPLICATE_EXPERIENCE'],
      });
      continue;
    }

    let bestDay: number | null = null;
    let bestScore = -Infinity;
    const dayFailureReasons = new Set<PlanningRejectionReason>();

    for (const [dayNumber, acc] of days) {
      const feasibility = await checkHardConstraints(candidate, acc, context);
      if (!feasibility.feasible) {
        feasibility.reasons.forEach((r) => dayFailureReasons.add(r));
        continue;
      }
      const score = scoreCandidateForDay(candidate, acc, context);
      if (score > bestScore) {
        bestScore = score;
        bestDay = dayNumber;
      }
    }

    if (bestDay === null) {
      unselected.push({
        experienceId: candidate.experienceId,
        reasons:
          dayFailureReasons.size > 0
            ? Array.from(dayFailureReasons)
            : ['NO_FEASIBLE_DAY'],
      });
      continue;
    }

    const acc = days.get(bestDay)!;
    const previous = acc.assigned[acc.assigned.length - 1];
    const travel = previous
      ? await context.travelEstimateProvider.estimate(
          previous.spatialFootprint,
          candidate.spatialFootprint,
          context.mobility.allowedTransportationModes,
        )
      : null;

    acc.assigned.push(candidate);
    acc.totalExperienceMinutes +=
      candidateExperienceMinutes(candidate) + (travel?.durationMinutes ?? 0);
    acc.totalWalkingMeters +=
      internalWalkingMeters(candidate, context.policy) +
      (travel?.walkingDistanceMeters ?? 0);
    placedIds.add(candidateIdentity(candidate));
  }

  return { days, unselected };
}
