import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';
import { TransportationMode } from 'src/modules/tours/interfaces/tour-generation.interface';
import { DeterministicTravelEstimator } from '../harness/travel-estimator-mock';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';
import { assertWithinDailyWalkingBudget } from '../harness/planning-assertions';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';

describe('PBT-04: Mobility & Walking Constraints [Invariant 4]', () => {
  const policy = dailyPlanningPolicyConfig();
  const travelEstimator = new DeterministicTravelEstimator();
  const solver = new GreedyDailyPlanningSolver(travelEstimator, policy);

  it('never exceeds the maximum daily walking distance budget for any generated day', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 2000, max: 10000 }),
        arbitraryCandidatePool(4, 15),
        async (requestedDays, maxWalkingMeters, candidates) => {
          const input = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withMobility({
              allowedTransportationModes: [TransportationMode.WALKING],
              maxWalkingDistancePerDayMeters: maxWalkingMeters,
              maxContinuousWalkingDistanceMeters: maxWalkingMeters,
            })
            .withCandidates(candidates)
            .build();

          const solution = await solver.solve(input);

          for (const day of solution.days) {
            assertWithinDailyWalkingBudget(day, maxWalkingMeters);
          }

          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 20 },
    );
  });
});
