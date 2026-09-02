import {
  DAILY_PLANNING_SOLVER,
  TRAVEL_ESTIMATE_PROVIDER,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
  DailyPlanningSolution,
  PlanningExperienceCandidate,
  NormalizedOpeningHours,
} from './daily-planning.interface';

describe('daily-planning.interface', () => {
  it('exposes string DI tokens', () => {
    expect(DAILY_PLANNING_SOLVER).toBe('DAILY_PLANNING_SOLVER');
    expect(TRAVEL_ESTIMATE_PROVIDER).toBe('TRAVEL_ESTIMATE_PROVIDER');
    expect(TOUR_PLANNING_FEASIBILITY_VALIDATOR).toBe(
      'TOUR_PLANNING_FEASIBILITY_VALIDATOR',
    );
  });

  it('constructs a valid PlanningExperienceCandidate literal', () => {
    const candidate: PlanningExperienceCandidate = {
      experienceId: 'e1',
      activityId: 'a1',
      kind: 'POI',
      title: 'Test',
      durationMinutes: 60,
      spatialFootprint: { type: 'POINT', centroid: { lat: 1, lng: 2 } },
      semanticScore: 0.5,
    };
    expect(candidate.durationMinutes).toBe(60);
  });

  it('constructs a valid unknown NormalizedOpeningHours', () => {
    const hours: NormalizedOpeningHours = { status: 'unknown' };
    expect(hours.status).toBe('unknown');
  });

  it('constructs a valid empty DailyPlanningSolution', () => {
    const solution: DailyPlanningSolution = {
      days: [],
      unselected: [],
      score: 0,
      metadata: { solver: 'test', approximateTravel: true },
    };
    expect(solution.days).toHaveLength(0);
  });
});
