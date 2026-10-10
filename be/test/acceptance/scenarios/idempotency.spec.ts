import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { BUENOS_AIRES_CANDIDATES } from '../fixtures/buenos-aires.fixture';

describe('Golden Scenario: End-to-End Idempotency (TC-E2E-05)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('running the solver 5 consecutive times produces bit-exact identical plans', async () => {
    const input = new TourInputBuilder()
      .withDays(3)
      .withCandidates(BUENOS_AIRES_CANDIDATES)
      .build();

    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      const solution = await solver.solve(input);
      results.push(JSON.stringify(solution));
    }

    const firstResult = results[0];
    for (const res of results) {
      expect(res).toBe(firstResult);
    }
  });
});
