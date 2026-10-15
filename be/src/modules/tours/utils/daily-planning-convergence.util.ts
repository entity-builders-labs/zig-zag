import {
  PlannerResidualCapacity,
  PlanningDay,
} from '../interfaces/daily-planning.interface';

/** Remaining time of one planned day with the planner's meaningful-residual
 * judgement (the single residual-capacity policy). */
export function dayResidualCapacity(
  day: PlanningDay,
  utilizationMinutes: number,
  minimumUsefulResidualMinutes: number,
): PlannerResidualCapacity {
  const availableMinutes =
    day.window.endMinutesFromMidnight -
    day.window.startMinutesFromMidnight -
    utilizationMinutes;
  return {
    dayNumber: day.dayNumber,
    availableMinutes,
    meaningful: availableMinutes >= minimumUsefulResidualMinutes,
  };
}
