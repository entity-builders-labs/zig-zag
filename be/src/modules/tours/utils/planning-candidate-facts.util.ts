import {
  PlanningDayOpeningHours,
  PlanningExperienceCandidate,
  PlanningVisitFacts,
} from '../interfaces/daily-planning.interface';

/**
 * The visit facts a candidate is scheduled with when they collapse to one
 * visit: the transitional Experience-level facts of a legacy composite, or
 * the facts of a single-place Experience's only VISIT component. Null when
 * the candidate needs a composite internal timeline over several VISIT
 * components, which only the optimizer of task 33.1 models.
 */
export function collapsedVisitFacts(
  candidate: PlanningExperienceCandidate,
): PlanningVisitFacts | null {
  if (candidate.legacyExperienceFacts) return candidate.legacyExperienceFacts;
  const visits = candidate.components.filter(
    (component) => component.participation === 'VISIT',
  );
  return visits.length === 1 ? visits[0].visit : null;
}

/** Collapsed facts; callers must have checked `collapsedVisitFacts` first. */
export function requireCollapsedVisitFacts(
  candidate: PlanningExperienceCandidate,
): PlanningVisitFacts {
  const facts = collapsedVisitFacts(candidate);
  if (!facts) {
    throw new Error(
      `Experience ${candidate.experienceId} has no single-visit planning facts`,
    );
  }
  return facts;
}

export function visitOpeningHoursOnDay(
  facts: PlanningVisitFacts,
  dayNumber: number,
): PlanningDayOpeningHours {
  return facts.openingHoursByDay[dayNumber - 1];
}
