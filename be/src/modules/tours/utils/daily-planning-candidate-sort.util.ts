import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';

/** Deterministic initial ordering used to drive anchor seeding and the
 * greedy placement loop. Only semantic/quality/lexical signals — requested-
 * format relevance, geographic compactness, and redundancy are handled by
 * the day-placement soft score (daily-planning-placement.util.ts) and local
 * improvement, not duplicated here. Never depends on DB result order or
 * object iteration order. */
export function sortCandidatesDeterministically(
  candidates: PlanningExperienceCandidate[],
): PlanningExperienceCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.semanticScore !== a.semanticScore) {
      return b.semanticScore - a.semanticScore;
    }
    const aQuality = a.qualityScore ?? 0;
    const bQuality = b.qualityScore ?? 0;
    if (bQuality !== aQuality) {
      return bQuality - aQuality;
    }
    return a.experienceId.localeCompare(b.experienceId);
  });
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
