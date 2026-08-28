import {
  DailyPlanningWindow,
  PlanningActivityCandidate,
  PlanningRejectionReason,
  TravelEstimateProvider,
  UnselectedPlanningCandidate,
} from '../interfaces/daily-planning.interface';
import {
  ExperienceFormat,
  MobilityPreferences,
  TransportationMode,
} from '../interfaces/tour-generation.interface';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';
import { isOpenDuring } from './normalized-opening-hours.util';

export interface DayAccumulator {
  dayNumber: number;
  assigned: PlanningActivityCandidate[];
  totalActivityMinutes: number;
  totalWalkingMeters: number;
}

export interface PlacementContext {
  policy: DailyPlanningPolicy;
  mobility: MobilityPreferences;
  planningWindow: DailyPlanningWindow;
  requestedFormats: ExperienceFormat[];
  travelEstimateProvider: TravelEstimateProvider;
  /** ISO date strings — empty means no confirmed base date, so weekday-
   * specific opening-hours checks are skipped rather than guessed. */
  startDates: string[];
}

function isCompositeKind(kind: PlanningActivityCandidate['kind']): boolean {
  return (
    kind === 'NEIGHBORHOOD_WALK' || kind === 'ROUTE' || kind === 'EXPERIENCE'
  );
}

/** Resolves the JS weekday (0=Sun..6=Sat) for a given planning day number,
 * from the tour's first confirmed start date. Deliberately parses the
 * `YYYY-MM-DD` components and constructs the Date with the local-time
 * constructor (`new Date(y, m, d)`) rather than `new Date(dateOnlyString)` —
 * a date-only ISO string parses as UTC midnight, while `Date#getDay()`
 * reads the *local* calendar day, so on any host west of UTC that pairing
 * silently reports the previous day's weekday. Adding `dayNumber - 1` days
 * via the constructor's day argument lets JS normalize month/year rollover
 * for multi-day tours for free. */
function resolveWeekday(
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

function internalWalkingMeters(
  candidate: PlanningActivityCandidate,
  policy: DailyPlanningPolicy,
): number {
  if (candidate.mobility?.internalWalkingDistanceMeters !== undefined) {
    return candidate.mobility.internalWalkingDistanceMeters;
  }
  if (isCompositeKind(candidate.kind)) {
    // Unknown internal walking on a composite: apply the explicit,
    // configurable conservative V1 fallback — never derived from duration.
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
  candidate: PlanningActivityCandidate,
  acc: DayAccumulator,
  context: PlacementContext,
): Promise<{ feasible: boolean; reasons: PlanningRejectionReason[] }> {
  const reasons: PlanningRejectionReason[] = [];

  if (
    candidate.spatialFootprint.centroid.lat === undefined ||
    candidate.spatialFootprint.centroid.lng === undefined ||
    Number.isNaN(candidate.spatialFootprint.centroid.lat) ||
    Number.isNaN(candidate.spatialFootprint.centroid.lng)
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
  const projectedActivityMinutes =
    acc.totalActivityMinutes +
    candidate.durationMinutes +
    (candidate.mobility?.internalTravelMinutes ?? 0) +
    (travel?.durationMinutes ?? 0);
  if (projectedActivityMinutes > dayWindowMinutes) {
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
  // V1 treats one inter-Activity leg as one continuous segment (documented
  // approximation — see the plan's "internal walking, reconciled" section).
  if (legWalkingMeters > context.mobility.maxContinuousWalkingDistanceMeters) {
    reasons.push('MAX_CONTINUOUS_WALKING_EXCEEDED');
  }

  if (candidate.openingHours) {
    const weekday = resolveWeekday(context.startDates, acc.dayNumber);
    if (weekday !== undefined) {
      const proposedStart =
        context.planningWindow.startMinutesFromMidnight +
        acc.totalActivityMinutes;
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
  candidate: PlanningActivityCandidate,
  acc: DayAccumulator,
  context: PlacementContext,
): number {
  const { scoring } = context.policy;
  const semantic = scoring.semanticWeight * candidate.semanticScore;
  // Unknown quality contributes 0, never a penalty relative to an explicit 0.
  const quality = scoring.qualityWeight * (candidate.qualityScore ?? 0);
  const formatBonus = candidate.formats?.some((f) =>
    context.requestedFormats.includes(f),
  )
    ? scoring.formatWeight
    : 0;
  const dayBalanceBonus =
    scoring.dayBalanceWeight * (1 / (acc.assigned.length + 1));
  const familyPenalty =
    candidate.familyId &&
    acc.assigned.some((a) => a.familyId === candidate.familyId)
      ? scoring.familyVariantPenaltyWeight
      : 0;
  return semantic + quality + formatBonus + dayBalanceBonus - familyPenalty;
}

/** Greedy day placement: for each candidate (already sorted by the caller),
 * finds every hard-feasible day and assigns it to whichever scores highest.
 * Duplicate activityIds and a `requestedDays` of 0 are handled here, at the
 * placement-loop layer — not inside `checkHardConstraints`, which only ever
 * evaluates one candidate against one day's state. */
export async function placeCandidates(
  sortedCandidates: PlanningActivityCandidate[],
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
      totalActivityMinutes: 0,
      totalWalkingMeters: 0,
    });
  }

  const placedIds = new Set<string>();
  const unselected: UnselectedPlanningCandidate[] = [];

  for (const candidate of sortedCandidates) {
    if (placedIds.has(candidate.activityId)) {
      unselected.push({
        activityId: candidate.activityId,
        reasons: ['DUPLICATE_ACTIVITY'],
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
        activityId: candidate.activityId,
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
    acc.totalActivityMinutes +=
      candidate.durationMinutes +
      (candidate.mobility?.internalTravelMinutes ?? 0) +
      (travel?.durationMinutes ?? 0);
    acc.totalWalkingMeters +=
      internalWalkingMeters(candidate, context.policy) +
      (travel?.walkingDistanceMeters ?? 0);
    placedIds.add(candidate.activityId);
  }

  return { days, unselected };
}
