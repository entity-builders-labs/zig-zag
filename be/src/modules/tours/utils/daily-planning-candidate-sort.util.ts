import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';

/** Deterministic initial ordering used to drive anchor seeding and the
 * greedy placement loop. The upstream catalog ranking is authoritative for
 * user relevance, so preserve its complete deterministic score when present.
 * Direct planner callers that do not cross that boundary fall back to the raw
 * semantic signal. Geographic compactness and redundancy remain day-planning
 * concerns and are not recomputed here. Never depends on DB result order or
 * object iteration order. */
export function sortCandidatesDeterministically(
  candidates: PlanningExperienceCandidate[],
): PlanningExperienceCandidate[] {
  return [...candidates].sort((a, b) => {
    const aRanking = a.rankingScore ?? a.semanticScore;
    const bRanking = b.rankingScore ?? b.semanticScore;
    if (bRanking !== aRanking) {
      return bRanking - aRanking;
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
