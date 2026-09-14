import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import { DailyPlanningPolicy } from '../config/daily-planning-policy.config';

type PlannerSoftScoring = Pick<
  DailyPlanningPolicy['scoring'],
  'semanticWeight' | 'qualityWeight'
>;

export function plannerRelevanceScore(
  candidate: PlanningExperienceCandidate,
  scoring: PlannerSoftScoring,
): number {
  return (
    scoring.semanticWeight * candidate.semanticScore +
    (candidate.preferenceWeight ?? 0) +
    scoring.qualityWeight * ((candidate.qualityScore ?? 0) / 5)
  );
}

/** Deterministic initial ordering used to drive anchor seeding and the
 * greedy placement loop. It uses the same explicit soft-relevance formula as
 * placement; geographic compactness and redundancy remain day-planning
 * concerns. Never depends on DB result order or object iteration order. */
export function sortCandidatesDeterministically(
  candidates: PlanningExperienceCandidate[],
  scoring: PlannerSoftScoring = dailyPlanningPolicyConfig().scoring,
): PlanningExperienceCandidate[] {
  return [...candidates].sort((a, b) => {
    const aRanking = plannerRelevanceScore(a, scoring);
    const bRanking = plannerRelevanceScore(b, scoring);
    if (bRanking !== aRanking) {
      return bRanking - aRanking;
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
