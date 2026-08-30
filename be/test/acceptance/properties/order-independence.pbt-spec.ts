import * as fc from 'fast-check';
import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { arbitraryCandidatePool } from '../arbitraries/candidate.arbitrary';

describe('PBT-07: Candidate Order Independence (TC-PBT-07)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('shuffling input.candidates produces identical set of selected activities', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        arbitraryCandidatePool(5, 15),
        async (days, pool) => {
          const inputOriginal = new TourInputBuilder()
            .withDays(days)
            .withCandidates(pool)
            .build();

          const shuffledPool = [...pool].reverse();
          const inputShuffled = new TourInputBuilder()
            .withDays(days)
            .withCandidates(shuffledPool)
            .build();

          const solution1 = await solver.solve(inputOriginal);
          const solution2 = await solver.solve(inputShuffled);

          const ids1 = solution1.days
            .flatMap((d) => d.activities.map((a) => a.activityId))
            .sort();
          const ids2 = solution2.days
            .flatMap((d) => d.activities.map((a) => a.activityId))
            .sort();

          expect(ids1).toEqual(ids2);
        },
      ),
      { numRuns: 20 },
    );
  });
});
