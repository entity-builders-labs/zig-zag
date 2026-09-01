import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';
import { DeterministicTravelEstimator } from '../harness/travel-estimator-mock';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';
import { assertOpeningHoursComplied } from '../harness/planning-assertions';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';

describe('PBT-05: Opening Hours Compliance [Invariant 5]', () => {
  const policy = dailyPlanningPolicyConfig();
  const travelEstimator = new DeterministicTravelEstimator();
  const solver = new GreedyDailyPlanningSolver(travelEstimator, policy);

  it('never schedules an activity during its closed hours or closed weekdays', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        arbitraryCandidatePool(4, 15),
        async (requestedDays, candidates) => {
          const input = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withStartDates('2026-09-07T00:00:00.000Z') // Monday
            .withCandidates(candidates)
            .build();

          const solution = await solver.solve(input);
          const candidateMap = new Map(
            candidates.map((c) => [c.activityId, c]),
          );

          for (const day of solution.days) {
            assertOpeningHoursComplied(day, candidateMap, input.startDates[0]);
          }

          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 20 },
    );
  });
});
