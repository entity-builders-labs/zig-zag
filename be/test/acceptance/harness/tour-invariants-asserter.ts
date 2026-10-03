import {
  DailyPlanningInput,
  DailyPlanningSolution,
  PlanningExperienceCandidate,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import {
  assertNoTemporalOverlap,
  assertWithinDailyWalkingBudget,
  assertWithinContinuousWalkingBudget,
  assertNoRogueModes,
  assertOpeningHoursComplied,
  assertGeographicallyReasonable,
} from './planning-assertions';

export class TourInvariantsAsserter {
  static assertAll12Invariants(
    solution: DailyPlanningSolution,
    input: DailyPlanningInput,
  ): void {
    expect(solution.days).toHaveLength(input.requestedDays);
    const candidateMap = new Map<string, PlanningExperienceCandidate>(
      input.candidates.map((c) => [c.experienceId!, c]),
    );
    const selected: string[] = [];
    for (const [index, day] of solution.days.entries()) {
      expect(day.dayNumber).toBe(index + 1);
      assertNoTemporalOverlap(day);
      assertWithinDailyWalkingBudget(
        day,
        input.mobility.maxWalkingDistancePerDayMeters,
      );
      assertWithinContinuousWalkingBudget(
        day,
        input.mobility.maxContinuousWalkingDistanceMeters,
      );
      assertNoRogueModes(day, input.mobility.allowedTransportationModes);
      assertOpeningHoursComplied(day, candidateMap, input.startDates[0]);
      assertGeographicallyReasonable(day, candidateMap);
      for (const experience of day.experiences) {
        expect(candidateMap.has(experience.experienceId)).toBe(true);
        selected.push(experience.experienceId);
      }
    }
    expect(new Set(selected).size).toBe(selected.length);
    const unselected = new Set(solution.unselected.map((c) => c.experienceId));
    for (const candidate of input.candidates) {
      if (!selected.includes(candidate.experienceId!))
        expect(unselected.has(candidate.experienceId!)).toBe(true);
    }
  }
}
