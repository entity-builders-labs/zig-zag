import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-03: Strict Temporal Monotonicity Invariant (TC-PBT-03)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('no activities overlap temporally and start(i+1) >= end(i) + travel(i->i+1)', async () => {
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

          for (const day of solution.days) {
            for (let i = 0; i < day.activities.length - 1; i++) {
              const current = day.activities[i];
              const next = day.activities[i + 1];
              const travel = next.travelFromPrevious?.durationMinutes ?? 0;

              expect(next.startMinutesFromMidnight).toBeGreaterThanOrEqual(
                current.endMinutesFromMidnight + travel,
              );
            }
          }

          TourInvariantsAsserter.assertAll12Invariants(solution, input);
        },
      ),
      { numRuns: 30 },
    );
  });
});
