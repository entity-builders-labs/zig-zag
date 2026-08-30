import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';
import { DeterministicTravelEstimator } from '../harness/travel-estimator-mock';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';

describe('PBT-01: Days Partitioning [Invariant 3]', () => {
  const policy = dailyPlanningPolicyConfig();
  const travelEstimator = new DeterministicTravelEstimator();
  const solver = new GreedyDailyPlanningSolver(travelEstimator, policy);

  it('generates exactly N day buckets for any N in [1..14] on arbitrary candidate pools', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 14 }),
        arbitraryCandidatePool(3, 20),
        async (requestedDays, candidates) => {
          const input = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withCandidates(candidates)
            .build();

          const solution = await solver.solve(input);

          expect(solution.days).toHaveLength(requestedDays);
          for (let d = 0; d < solution.days.length; d++) {
            expect(solution.days[d].dayNumber).toBe(d + 1);
          }

          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 25 },
    );
  });
});
