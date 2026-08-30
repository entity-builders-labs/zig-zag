import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';
import { DeterministicTravelEstimator } from '../harness/travel-estimator-mock';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-07: Pool Order Independence [Invariant 11]', () => {
  const policy = dailyPlanningPolicyConfig();
  const travelEstimator = new DeterministicTravelEstimator();
  const solver = new GreedyDailyPlanningSolver(travelEstimator, policy);

  it('guarantees that shuffling the candidate pool produces the identical daily plan', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        arbitraryCandidatePool(4, 12),
        async (requestedDays, candidates) => {
          const inputOriginal = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withCandidates(candidates)
            .build();

          // Reverse or shuffle the array
          const shuffledCandidates = [...candidates].reverse();
          const inputShuffled = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withCandidates(shuffledCandidates)
            .build();

          const solution1 = await solver.solve(inputOriginal);
          const solution2 = await solver.solve(inputShuffled);

          expect(solution1.days).toEqual(solution2.days);
        },
      ),
      { numRuns: 20 },
    );
  });
});
