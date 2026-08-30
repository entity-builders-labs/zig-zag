import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { DeterministicTravelEstimator } from './travel-estimator-mock';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';

export function createGreedySolver(
  estimator: DeterministicTravelEstimator = new DeterministicTravelEstimator(),
): { solver: GreedyDailyPlanningSolver; estimator: DeterministicTravelEstimator } {
  const policy = dailyPlanningPolicyConfig();
  const solver = new GreedyDailyPlanningSolver(estimator, policy);
  return { solver, estimator };
}
