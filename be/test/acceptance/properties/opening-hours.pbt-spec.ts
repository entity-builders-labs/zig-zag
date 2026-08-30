import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-05: Opening Hours Invariant (TC-PBT-05)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('never schedules an activity on a day it is explicitly closed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        arbitraryCandidatePool(5, 25),
        async (days, pool) => {
          const input = new TourInputBuilder()
            .withDays(days)
            .withCandidates(pool)
            .withStartDates(['2026-09-07T00:00:00.000Z']) // Monday
            .build();

          const solution = await solver.solve(input);

          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 25 },
    );
  });
});
