import { PlanningPolicyVersions } from '../interfaces/daily-planning.interface';

/**
 * Versions of the planner policies in force before the preference-first
 * pipeline is wired. They name existing behaviour so every plan records the
 * policies it ran under; they add no semantics.
 *
 * - Ranking: the set-based preference composition order of
 *   `ExperienceCompositionService`, until task 25.2's preference-utility
 *   policy replaces it.
 * - Objective: `plannerRelevanceScore` with the configured weights in
 *   `GreedyDailyPlanningSolver`, until task 33.1 retires it.
 * - UNKNOWN opening hours: the greedy solver keeps UNKNOWN visits feasible
 *   and marks them UNKNOWN in the plan, until task 26.2 implements the
 *   versioned policy with the P-D4 default PENALIZE.
 */
export const GREEDY_PLANNING_POLICY_VERSIONS: PlanningPolicyVersions = {
  rankingPolicyVersion: 'legacy-composition-ranking-v1',
  objectivePolicyVersion: 'greedy-relevance-v1',
  unknownOpeningHours: {
    mode: 'ALLOW_WITH_UNCERTAINTY',
    version: 'greedy-allow-unknown-v1',
  },
};
