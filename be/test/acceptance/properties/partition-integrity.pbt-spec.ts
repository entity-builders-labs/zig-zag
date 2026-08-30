import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-08: Partition & Reason Integrity (TC-PBT-08)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('selected union unselected equals full candidate pool with valid exclusion reasons', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        arbitraryCandidatePool(4, 25),
        async (days, pool) => {
          const input = new TourInputBuilder()
            .withDays(days)
            .withCandidates(pool)
            .build();

          const solution = await solver.solve(input);

          const scheduledIds = solution.days.flatMap((d) =>
            d.activities.map((a) => a.activityId),
          );
          const unselectedIds = solution.unselected.map((u) => u.activityId);

          // Every unselected item has valid non-empty reasons
          for (const u of solution.unselected) {
            expect(u.reasons.length).toBeGreaterThan(0);
          }

          // Every pool item is in selected OR unselected
          for (const c of pool) {
            const isAccountedFor =
              scheduledIds.includes(c.activityId) ||
              unselectedIds.includes(c.activityId);
            expect(isAccountedFor).toBe(true);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});
