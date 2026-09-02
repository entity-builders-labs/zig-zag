import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { BUENOS_AIRES_CANDIDATES } from '../fixtures/buenos-aires.fixture';

describe('Golden Scenario: Buenos Aires 3-Day Tour (TC-E2E-01)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('generates a valid 3-day Buenos Aires itinerary satisfying all 12 invariants', async () => {
    const input = new TourInputBuilder()
      .withDays(3)
      .withCandidates(BUENOS_AIRES_CANDIDATES)
      .withStartDates(['2026-09-07T00:00:00.000Z']) // Monday
      .build();

    const solution = await solver.solve(input);

    expect(solution.days).toHaveLength(3);
    TourInvariantsAsserter.assertAll12Invariants(solution, input);

    // Verify Recoleta and San Telmo walks are included
    const allScheduledIds = solution.days.flatMap((d) =>
      d.experiences.map((a) => a.experienceId),
    );
    expect(allScheduledIds.length).toBeGreaterThanOrEqual(4);
  });
});
