import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';
import { DeterministicTravelEstimator } from '../harness/travel-estimator-mock';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-06: Determinism [Invariant 11]', () => {
  const policy = dailyPlanningPolicyConfig();
  const travelEstimator = new DeterministicTravelEstimator();
  const solver = new GreedyDailyPlanningSolver(travelEstimator, policy);

  it('guarantees solve(input) === solve(input) produces identical deep equality', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        arbitraryCandidatePool(3, 15),
        async (requestedDays, candidates) => {
          const input1 = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withCandidates(candidates)
            .build();

          const input2 = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withCandidates(candidates.map((c) => ({ ...c })))
            .build();

          const solution1 = await solver.solve(input1);
          const solution2 = await solver.solve(input2);

          expect(solution1).toEqual(solution2);
        },
      ),
      { numRuns: 20 },
    );
  });
});
