import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { VGB_CANDIDATES } from '../fixtures/villa-general-belgrano.fixture';

describe('Golden Scenario: Villa General Belgrano 1-Day Alpine Walk (TC-E2E-03)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('generates a 1-day walking tour with alpine historic center and scenic walk', async () => {
    const input = new TourInputBuilder()
      .withDays(1)
      .withCandidates(VGB_CANDIDATES)
      .build();

    const solution = await solver.solve(input);

    expect(solution.days).toHaveLength(1);
    expect(solution.days[0].experiences.length).toBeGreaterThanOrEqual(2);
    TourInvariantsAsserter.assertAll12Invariants(solution, input);
  });
});
