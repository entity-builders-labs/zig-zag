import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';
import { DeterministicTravelEstimator } from '../harness/travel-estimator-mock';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';
import { assertNoTemporalOverlap } from '../harness/planning-assertions';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';

describe('PBT-03: Chronology & Non-Overlap [Invariants 4 & 9]', () => {
  const policy = dailyPlanningPolicyConfig();
  const travelEstimator = new DeterministicTravelEstimator();
  const solver = new GreedyDailyPlanningSolver(travelEstimator, policy);

  it('ensures all planned activities have strictly monotonic and non-overlapping time intervals', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        arbitraryCandidatePool(4, 15),
        async (requestedDays, candidates) => {
          const input = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withCandidates(candidates)
            .build();

          const solution = await solver.solve(input);

          for (const day of solution.days) {
            assertNoTemporalOverlap(day);
          }

          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 25 },
    );
  });
});
