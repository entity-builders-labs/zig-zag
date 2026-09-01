import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';
import { DeterministicTravelEstimator } from '../harness/travel-estimator-mock';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidate } from '../arbitraries/candidate.arbitrary';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';

describe('PBT-02: Uniqueness [Invariant 6]', () => {
  const policy = dailyPlanningPolicyConfig();
  const travelEstimator = new DeterministicTravelEstimator();
  const solver = new GreedyDailyPlanningSolver(travelEstimator, policy);

  it('ensures no activityId appears more than once in the whole solution even with forced pool collisions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.array(arbitraryCandidate('colliding'), {
          minLength: 2,
          maxLength: 6,
        }),
        async (requestedDays, baseCandidates) => {
          // Intentionally duplicate candidates in pool
          const noisyPool = [
            ...baseCandidates,
            ...baseCandidates.map((c) => ({ ...c })),
          ];

          const input = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withCandidates(noisyPool)
            .build();

          const solution = await solver.solve(input);

          const scheduledIds = solution.days.flatMap((d) =>
            d.activities.map((a) => a.activityId),
          );
          const uniqueIds = new Set(scheduledIds);

          expect(uniqueIds.size).toBe(scheduledIds.length);
          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 25 },
    );
  });
});
