import { PlanningPolicyVersions } from '../interfaces/daily-planning.interface';
import { PREFERENCE_UTILITY_POLICY_VERSION } from '../interfaces/preference-utility.interface';

/**
 * Versions of the planner policies of the greedy solver. They name existing
 * behaviour so every plan records the policies it ran under; they add no
 * semantics.
 *
 * - Ranking: the canonical preference utility of task 25.2
 *   (`PreferenceUtilityService`).
 * - Objective: greedy placement in canonical preference-rank order with
 *   day balance, until task 33.1 retires it.
 * - UNKNOWN opening hours: the greedy solver keeps UNKNOWN visits feasible
 *   and marks them UNKNOWN in the plan, until task 26.2 implements the
 *   versioned policy with the P-D4 default PENALIZE.
 */
export const GREEDY_PLANNING_POLICY_VERSIONS: PlanningPolicyVersions = {
  rankingPolicyVersion: PREFERENCE_UTILITY_POLICY_VERSION,
  objectivePolicyVersion: 'greedy-preference-rank-v1',
  unknownOpeningHours: {
    mode: 'ALLOW_WITH_UNCERTAINTY',
    version: 'greedy-allow-unknown-v1',
  },
};
