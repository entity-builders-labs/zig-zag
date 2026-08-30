import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-02: Hard Uniqueness Invariant (TC-PBT-02)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('every scheduled activityId is unique across the entire multi-day itinerary', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        arbitraryCandidatePool(5, 30),
        async (days, pool) => {
          const input = new TourInputBuilder()
            .withDays(days)
            .withCandidates(pool)
            .build();

          const solution = await solver.solve(input);

          const scheduledIds = solution.days.flatMap((d) =>
            d.activities.map((a) => a.activityId),
          );
          const uniqueIds = new Set(scheduledIds);

          expect(scheduledIds.length).toBe(uniqueIds.size);
          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 30 },
    );
  });
});
