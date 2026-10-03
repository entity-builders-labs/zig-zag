import {
  DailyPlanningSolution,
  DailyPlanningWindow,
  PlannerResidualCapacity,
} from '../interfaces/daily-planning.interface';

export function plannerResidualCapacity(
  solution: DailyPlanningSolution,
  planningWindow: DailyPlanningWindow,
  minimumUsefulResidualMinutes: number,
): PlannerResidualCapacity[] {
  const windowMinutes =
    planningWindow.endMinutesFromMidnight -
    planningWindow.startMinutesFromMidnight;
  return solution.days.map((day) => {
    const availableMinutes = windowMinutes - day.utilizationMinutes;
    return {
      dayNumber: day.dayNumber,
      availableMinutes,
      meaningful: availableMinutes >= minimumUsefulResidualMinutes,
    };
  });
}
