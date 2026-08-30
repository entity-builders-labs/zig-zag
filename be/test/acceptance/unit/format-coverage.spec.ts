import { GreedyDailyPlanningSolver } from 'src/modules/tours/services/greedy-daily-planning.solver';
import { createGreedySolver } from '../harness/solver-factory';
import { CandidateBuilder } from '../builders/candidate.builder';
import { TourInputBuilder } from '../builders/tour-input.builder';
import { ExperienceFormat } from 'src/modules/tours/interfaces/tour-generation.interface';

describe('Unit Acceptance: Format Coverage & Soft Penalties (TC-FMT-01 to TC-FMT-02)', () => {
  let solver: GreedyDailyPlanningSolver;

  beforeEach(() => {
    const context = createGreedySolver();
    solver = context.solver;
  });

  it('TC-FMT-01: prioritizes requested formats when feasible in pool', async () => {
    const pointVisit = new CandidateBuilder()
      .withId('poi-1')
      .withScores(0.85, 0.85)
      .withFormats(ExperienceFormat.POINT_VISITS)
      .build();

    const walk = new CandidateBuilder()
      .withId('walk-1')
      .withScores(0.84, 0.84)
      .withFormats(ExperienceFormat.NEIGHBORHOOD_WALKS)
      .build();

    const input = new TourInputBuilder()
      .withDays(1)
      .withPlanningWindow(9 * 60, 13 * 60)
      .withCandidates([pointVisit, walk])
      .withRequestedFormats([ExperienceFormat.NEIGHBORHOOD_WALKS])
      .build();

    const solution = await solver.solve(input);
    const scheduledIds = solution.days[0].activities.map((a) => a.activityId);

    expect(scheduledIds).toContain('walk-1');
  });

  it('TC-FMT-02: soft penalizes same family variants across days without hard rejecting if needed', async () => {
    const variantA = new CandidateBuilder()
      .withId('family-variant-a')
      .withFamilyId('san-telmo-fam')
      .withScores(0.9, 0.9)
      .build();

    const variantB = new CandidateBuilder()
      .withId('family-variant-b')
      .withFamilyId('san-telmo-fam')
      .withScores(0.88, 0.88)
      .build();

    const input = new TourInputBuilder()
      .withDays(2)
      .withCandidates([variantA, variantB])
      .build();

    const solution = await solver.solve(input);

    const scheduledIds = solution.days.flatMap((d) =>
      d.activities.map((a) => a.activityId),
    );

    // Both can be scheduled if pool has no other items, but they are uniquely assigned
    expect(scheduledIds).toContain('family-variant-a');
  });
});
