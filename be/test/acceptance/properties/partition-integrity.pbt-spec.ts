import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import dailyPlanningPolicyConfig from 'src/modules/tours/config/daily-planning-policy.config';
import { DeterministicTravelEstimator } from '../harness/travel-estimator-mock';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-08: Partition Integrity [Invariant 10]', () => {
  const policy = dailyPlanningPolicyConfig();
  const travelEstimator = new DeterministicTravelEstimator();
  const solver = new GreedyDailyPlanningSolver(travelEstimator, policy);

  it('guarantees that every candidate in the pool is partitioned cleanly into either selected or unselected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        arbitraryCandidatePool(3, 15),
        async (requestedDays, candidates) => {
          // De-duplicate candidate pool by activityId
          const uniqueMap = new Map(candidates.map((c) => [c.activityId, c]));
          const uniqueCandidates = Array.from(uniqueMap.values());

          const input = TourInputBuilder.aTourInput()
            .withRequestedDays(requestedDays)
            .withCandidates(uniqueCandidates)
            .build();

          const solution = await solver.solve(input);

          const selectedIds = new Set(
            solution.days.flatMap((d) => d.activities.map((a) => a.activityId)),
          );
          const unselectedIds = new Set(
            solution.unselected.map((u) => u.activityId),
          );

          // Intersection is empty
          for (const sId of selectedIds) {
            expect(unselectedIds.has(sId)).toBe(false);
          }

          // Union equals input pool
          for (const cand of uniqueCandidates) {
            const isPartitioned =
              selectedIds.has(cand.activityId) ||
              unselectedIds.has(cand.activityId);
            expect(isPartitioned).toBe(true);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
