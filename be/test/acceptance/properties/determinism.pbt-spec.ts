import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-06: Strict Determinism Invariant (TC-PBT-06)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('solve(input) === solve(input) produces identical JSON output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        arbitraryCandidatePool(4, 15),
        async (days, pool) => {
          const input1 = new TourInputBuilder()
            .withDays(days)
            .withCandidates(pool)
            .build();

          const input2 = JSON.parse(JSON.stringify(input1));

          const solution1 = await solver.solve(input1);
          const solution2 = await solver.solve(input2);

          expect(JSON.stringify(solution1)).toBe(JSON.stringify(solution2));
        },
      ),
      { numRuns: 20 },
    );
  });
});
