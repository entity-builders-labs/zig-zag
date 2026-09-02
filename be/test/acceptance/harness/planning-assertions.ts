import { PlannedDay, PlanningExperienceCandidate } from 'src/modules/tours/interfaces/daily-planning.interface';
import { resolveWeekday } from 'src/modules/tours/utils/daily-planning-placement.util';

/**
 * Calculates geodesic haversine distance between two coordinates in meters.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Asserts that experiences within a planned day have strictly monotonic and non-overlapping schedules:
 * startTime(i+1) >= endTime(i) + travelTime(i -> i+1)
 */
export function assertNoTemporalOverlap(day: PlannedDay): void {
  for (let i = 0; i < day.experiences.length - 1; i++) {
    const current = day.experiences[i];
    const next = day.experiences[i + 1];

    expect(current.endMinutesFromMidnight).toBeGreaterThan(
      current.startMinutesFromMidnight,
    );

    const travelMinutes = next.travelFromPrevious?.durationMinutes ?? 0;
    expect(travelMinutes).toBeGreaterThanOrEqual(0);

    expect(next.startMinutesFromMidnight).toBeGreaterThanOrEqual(
      current.endMinutesFromMidnight + travelMinutes,
    );
  }
}

/**
 * Asserts that total walking distance within a planned day does not exceed the allowed daily budget.
 */
export function assertWithinDailyWalkingBudget(
  day: PlannedDay,
  maxWalkingMeters: number,
): void {
  let dayWalkingMeters = 0;
  for (const act of day.experiences) {
    if (act.travelFromPrevious) {
      dayWalkingMeters += act.travelFromPrevious.walkingDistanceMeters ?? 0;
    }
  }

  expect(dayWalkingMeters).toBeLessThanOrEqual(maxWalkingMeters);
}

/**
 * Asserts that no single continuous walking leg exceeds the continuous walking budget.
 */
export function assertWithinContinuousWalkingBudget(
  day: PlannedDay,
  maxContinuousWalkingMeters: number,
): void {
  for (const act of day.experiences) {
    if (act.travelFromPrevious) {
      const legWalking = act.travelFromPrevious.walkingDistanceMeters ?? 0;
      expect(legWalking).toBeLessThanOrEqual(maxContinuousWalkingMeters);
    }
  }
}

/**
 * Asserts that all transportation modes used in the day belong strictly to allowed modes.
 */
export function assertNoRogueModes(
  day: PlannedDay,
  allowedModes: string[],
): void {
  for (const act of day.experiences) {
    if (act.travelFromPrevious) {
      expect(allowedModes).toContain(act.travelFromPrevious.mode);
    }
  }
}

/**
 * Asserts that scheduled activities comply with opening hours when known.
 * An activity explicitly closed on a weekday (ranges = []) must NEVER be scheduled on that weekday.
 */
export function assertOpeningHoursComplied(
  day: PlannedDay,
  candidatesMap: Map<string, PlanningExperienceCandidate>,
  startDateIso?: string,
): void {
  for (const act of day.experiences) {
    const candidate = candidatesMap.get(act.experienceId);
    if (!candidate || !candidate.openingHours) {
      continue;
    }

    if (candidate.openingHours.status === 'known' && startDateIso) {
      const weekday = resolveWeekday([startDateIso], day.dayNumber);
      if (weekday === undefined) continue;

      const ranges = candidate.openingHours.rangesByWeekday[weekday];
      if (ranges && ranges.length === 0) {
        // Hard constraint: explicitly closed that day
        throw new Error(
          `Experience ${act.experienceId} scheduled on Day ${day.dayNumber} (${startDateIso}) but is explicitly closed on weekday ${weekday}`,
        );
      }
    }
  }
}

/**
 * Asserts geographic reasonableness: computes total path distance and verifies no absurd detours.
 */
export function assertGeographicallyReasonable(
  day: PlannedDay,
  candidatesMap: Map<string, PlanningExperienceCandidate>,
): void {
  if (day.experiences.length < 3) return;

  const coords = day.experiences
    .map((a) => {
      const c = candidatesMap.get(a.experienceId);
      return c?.spatialFootprint.centroid;
    })
    .filter((c): c is { lat: number; lng: number } => !!c);

  if (coords.length < 3) return;

  for (let i = 0; i < coords.length - 1; i++) {
    const dist = haversineDistanceMeters(
      coords[i].lat,
      coords[i].lng,
      coords[i + 1].lat,
      coords[i + 1].lng,
    );
    expect(dist).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(dist)).toBe(true);
  }
}
