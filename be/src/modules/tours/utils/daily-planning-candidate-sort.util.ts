import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';

/** Deterministic initial ordering used to drive anchor seeding and the
 * greedy placement loop: the canonical within-request preference rank
 * (task 25.2), then id. The planner never recombines preference signals
 * into a score; geographic compactness and redundancy remain day-planning
 * concerns. Never depends on DB result order or object iteration order. */
export function sortCandidatesDeterministically(
  candidates: PlanningExperienceCandidate[],
): PlanningExperienceCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      a.preference.rank - b.preference.rank ||
      a.experienceId.localeCompare(b.experienceId),
  );
}

/** Seeds each requested day with one strong, deterministic anchor so top
 * candidates don't all land on day 1. V1: the top `requestedDays` candidates
 * from the stable sort, one per day in order. No complex optimizer. */
export function selectDailyAnchors(
  sortedCandidates: PlanningExperienceCandidate[],
  requestedDays: number,
): PlanningExperienceCandidate[] {
  return sortedCandidates.slice(0, requestedDays);
}
