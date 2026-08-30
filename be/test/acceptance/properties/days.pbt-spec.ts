import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-01: Days Partition Invariant (TC-PBT-01)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('solution.days.length === requestedDays for any N in [1..7] and arbitrary candidate pool', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 7 }),
        arbitraryCandidatePool(1, 25),
        async (days, pool) => {
          const input = new TourInputBuilder()
            .withDays(days)
            .withCandidates(pool)
            .build();

          const solution = await solver.solve(input);

          expect(solution.days).toHaveLength(days);
          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 30 },
    );
  });
});
