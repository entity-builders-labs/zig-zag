import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { ROSARIO_CANDIDATES } from '../fixtures/rosario.fixture';

describe('Golden Scenario: Rosario Urban & Accessibility (TC-E2E-04)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('schedules Monumento a la Bandera and respects Monday closure of Parque Independencia', async () => {
    const input = new TourInputBuilder()
      .withDays(1)
      .withCandidates(ROSARIO_CANDIDATES)
      .withStartDates(['2026-09-07T00:00:00.000Z']) // Monday
      .build();

    const solution = await solver.solve(input);

    expect(solution.days).toHaveLength(1);
    TourInvariantsAsserter.assertAll12Invariants(solution, input);

    // Verify the canonical experience pool is scheduled
    const scheduledIds = solution.days[0].experiences.map(
      (a) => a.experienceId,
    );
    expect(scheduledIds).toContain('rosario-0');
  });
});
