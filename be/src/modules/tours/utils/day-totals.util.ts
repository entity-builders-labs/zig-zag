export interface DayTotals {
  dayNumber: number;
  experienceCount: number;
  totalExperienceMinutes: number;
  totalTravelMinutes: number;
  /**
   * Walking BETWEEN experiences only (sum of `travelFromPrevious.walkingMinutes`).
   * Does NOT include a multi-component Experience's own internal walking
   * between its components — the complete figure (both combined) is
   * available on `tour.metadata.generationTrace`'s own `totalWalkingMinutes`
   * for the same day, computed by the solver.
   */
  totalTravelWalkingMinutes: number;
  totalMinutes: number;
}

export interface TourExperienceForDayTotals {
  dayNumber: number | null;
  duration: number | null;
  travelFromPrevious?: {
    durationMinutes: number;
    walkingMinutes: number;
  } | null;
}

/**
 * Computed on every read rather than persisted as a separate aggregate —
 * trivially re-derivable from the same rows it summarizes, so there is no
 * second source of truth that could drift from them.
 */
export function computeDayTotals(
  experiences: TourExperienceForDayTotals[],
): DayTotals[] {
  const byDay = new Map<number, TourExperienceForDayTotals[]>();
  for (const experience of experiences) {
    if (experience.dayNumber == null) continue;
    const list = byDay.get(experience.dayNumber) ?? [];
    list.push(experience);
    byDay.set(experience.dayNumber, list);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([dayNumber, dayExperiences]) => {
      const totalExperienceMinutes = dayExperiences.reduce(
        (sum, experience) => sum + (experience.duration ?? 0) * 60,
        0,
      );
      const totalTravelMinutes = dayExperiences.reduce(
        (sum, experience) =>
          sum + (experience.travelFromPrevious?.durationMinutes ?? 0),
        0,
      );
      const totalTravelWalkingMinutes = dayExperiences.reduce(
        (sum, experience) =>
          sum + (experience.travelFromPrevious?.walkingMinutes ?? 0),
        0,
      );
      return {
        dayNumber,
        experienceCount: dayExperiences.length,
        totalExperienceMinutes: Math.round(totalExperienceMinutes),
        totalTravelMinutes: Math.round(totalTravelMinutes),
        totalTravelWalkingMinutes: Math.round(totalTravelWalkingMinutes),
        totalMinutes: Math.round(totalExperienceMinutes + totalTravelMinutes),
      };
    });
}
