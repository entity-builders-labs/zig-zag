import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { CandidateBuilder } from '../builders/candidate.builder';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { BUENOS_AIRES_CANDIDATES } from '../fixtures/buenos-aires.fixture';
import { TourInvariantsAsserter } from '../harness/tour-invariants-asserter';

describe('Unit Acceptance: Greedy Daily Planning Solver (TC-SOLV-01 to TC-SOLV-05)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('TC-SOLV-01: solves single-day tour correctly', async () => {
    const input = new TourInputBuilder()
      .withDays(1)
      .withCandidates(BUENOS_AIRES_CANDIDATES)
      .build();

    const solution = await solver.solve(input);

    expect(solution.days).toHaveLength(1);
    expect(solution.days[0].experiences.length).toBeGreaterThanOrEqual(1);
    TourInvariantsAsserter.assertAll12Invariants(solution, input);
  });

  it('TC-SOLV-02: solves multi-day tour with non-overlapping activities and unique IDs', async () => {
    const input = new TourInputBuilder()
      .withDays(3)
      .withCandidates(BUENOS_AIRES_CANDIDATES)
      .build();

    const solution = await solver.solve(input);

    expect(solution.days).toHaveLength(3);
    TourInvariantsAsserter.assertAll12Invariants(solution, input);
  });

  it('TC-SOLV-03: rejects candidate when time window is insufficient', async () => {
    const longCandidate = new CandidateBuilder()
      .withId('long-1')
      .withDuration(600) // 10 hours
      .build();

    const input = new TourInputBuilder()
      .withDays(1)
      .withPlanningWindow(9 * 60, 13 * 60) // 4 hours window
      .withCandidates([longCandidate])
      .build();

    const solution = await solver.solve(input);

    expect(solution.days[0].experiences).toHaveLength(0);
    expect(solution.unselected.some((u) => u.experienceId === 'long-1')).toBe(
      true,
    );
  });

  it('TC-SOLV-04: empty day bucket is valid when pool is exhausted or infeasible', async () => {
    const fewCandidates = [
      new CandidateBuilder().withId('cand-1').withDuration(60).build(),
    ];

    const input = new TourInputBuilder()
      .withDays(3)
      .withCandidates(fewCandidates)
      .build();

    const solution = await solver.solve(input);

    expect(solution.days).toHaveLength(3);
    const totalScheduled = solution.days.flatMap((d) => d.experiences).length;
    expect(totalScheduled).toBe(1);
  });

  it('TC-SOLV-05: deterministic solution regardless of invocation count', async () => {
    const input = new TourInputBuilder()
      .withDays(2)
      .withCandidates(BUENOS_AIRES_CANDIDATES)
      .build();

    const solA = await solver.solve(input);
    const solB = await solver.solve(input);

    expect(JSON.stringify(solA)).toBe(JSON.stringify(solB));
  });
});
