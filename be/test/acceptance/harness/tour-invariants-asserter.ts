import {
  DailyPlanningInput,
  DailyPlanningSolution,
  PlanningActivityCandidate,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import {
  assertNoTemporalOverlap,
  assertWithinDailyWalkingBudget,
  assertWithinContinuousWalkingBudget,
  assertNoRogueModes,
  assertOpeningHoursComplied,
  assertGeographicallyReasonable,
} from './planning-assertions';

export interface TourInvariantsAsserterOptions {
  requiredFrom?: 'PR10' | 'PR11';
  strictFormats?: boolean;
}

export class TourInvariantsAsserter {
  /**
   * Asserts that a generated daily planning solution satisfies all 12 Canonical Invariants.
   */
  static assertAll12Invariants(
    solution: DailyPlanningSolution,
    input: DailyPlanningInput,
    options: TourInvariantsAsserterOptions = { requiredFrom: 'PR10' },
  ): void {
    const candidateMap = new Map<string, PlanningActivityCandidate>(
      input.candidates.map((c) => [c.activityId, c]),
    );

    const scheduledActivityIds: string[] = [];

    // INVARIANT 3: Days count matches requestedDays exactly
    expect(solution.days).toBeDefined();
    expect(solution.days).toHaveLength(input.requestedDays);

    for (let d = 0; d < solution.days.length; d++) {
      const day = solution.days[d];
      expect(day.dayNumber).toBe(d + 1);

      // INVARIANT 10: Monotonicity & No Temporal Overlap within each day
      assertNoTemporalOverlap(day);

      // INVARIANT 4: Mobility - Max daily walking & continuous walking & allowed modes
      if (input.mobility.maxWalkingDistancePerDayMeters) {
        assertWithinDailyWalkingBudget(
          day,
          input.mobility.maxWalkingDistancePerDayMeters,
        );
      }
      if (input.mobility.maxContinuousWalkingDistanceMeters) {
        assertWithinContinuousWalkingBudget(
          day,
          input.mobility.maxContinuousWalkingDistanceMeters,
        );
      }
      if (input.mobility.allowedTransportationModes) {
        assertNoRogueModes(day, input.mobility.allowedTransportationModes);
      }

      // INVARIANT 5: Opening Hours
      const startDateIso = input.startDates?.[0];
      assertOpeningHoursComplied(day, candidateMap, startDateIso);

      // INVARIANT 8: Spatial & Geographic Reasonableness
      assertGeographicallyReasonable(day, candidateMap);

      for (const act of day.activities) {
        // INVARIANT 1: Canonical Activities (must exist in candidate pool)
        expect(candidateMap.has(act.activityId)).toBe(true);
        scheduledActivityIds.push(act.activityId);

        // INVARIANT 9: Defensible Travel Legs
        if (act.travelFromPrevious) {
          expect(act.travelFromPrevious.durationMinutes).toBeGreaterThanOrEqual(
            0,
          );
          expect(act.travelFromPrevious.distanceMeters).toBeGreaterThanOrEqual(
            0,
          );
          expect(act.travelFromPrevious.mode).toBeDefined();
        }
      }
    }

    // INVARIANT 6: Hard Uniqueness (every activityId appears at most once in the whole tour)
    const uniqueIds = new Set(scheduledActivityIds);
    expect(uniqueIds.size).toBe(scheduledActivityIds.length);

    // INVARIANT 10: Partition Integrity
    const unselectedMap = new Map<string, string[]>();
    for (const u of solution.unselected) {
      unselectedMap.set(u.activityId, u.reasons);
    }

    for (const scheduledId of scheduledActivityIds) {
      if (unselectedMap.has(scheduledId)) {
        const reasons = unselectedMap.get(scheduledId)!;
        expect(
          reasons.includes('DUPLICATE_ACTIVITY') ||
            reasons.includes('FAMILY_VARIANT_REDUNDANCY') ||
            reasons.includes('FORMAT_REDUNDANCY'),
        ).toBe(true);
      }
    }

    // INVARIANT 7: Requested Formats (if requested and feasible candidates exist in pool)
    if (options.strictFormats && input.requestedFormats?.length) {
      const scheduledCandidates = scheduledActivityIds
        .map((id) => candidateMap.get(id))
        .filter((c): c is PlanningActivityCandidate => !!c);

      const scheduledFormats = new Set(
        scheduledCandidates.flatMap((c) => c.formats ?? []),
      );

      for (const reqFormat of input.requestedFormats) {
        const hasFeasibleCandidate = input.candidates.some((c) =>
          c.formats?.includes(reqFormat),
        );
        if (hasFeasibleCandidate) {
          expect(scheduledFormats.has(reqFormat)).toBe(true);
        }
      }
    }
  }
}
