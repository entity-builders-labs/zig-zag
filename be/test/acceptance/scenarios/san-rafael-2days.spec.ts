import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { SAN_RAFAEL_CANDIDATES } from '../fixtures/san-rafael.fixture';
import { TransportationMode } from 'src/modules/tours/interfaces/tour-generation.interface';

describe('Golden Scenario: San Rafael 2-Day Driving Tour (TC-E2E-02)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('generates a 2-day driving/nature tour across Valle Grande and Atuel', async () => {
    const input = new TourInputBuilder()
      .withDays(2)
      .withCandidates(SAN_RAFAEL_CANDIDATES)
      .withMobility({
        allowedTransportationModes: [
          TransportationMode.DRIVING,
          TransportationMode.WALKING,
        ],
      })
      .withStartDates(['2026-09-08T00:00:00.000Z'])
      .build();

    const solution = await solver.solve(input);

    expect(solution.days).toHaveLength(2);
    TourInvariantsAsserter.assertAll12Invariants(solution, input);
  });
});
