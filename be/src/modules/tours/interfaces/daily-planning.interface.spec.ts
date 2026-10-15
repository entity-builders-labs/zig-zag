import {
  AppliedOpeningHours,
  DAILY_PLANNING_SOLVER,
  DailyPlanningInput,
  DailyPlanningSolution,
  NormalizedOpeningHours,
  PlannedDay,
  PlannedExperience,
  PlannedLegSummary,
  PlannerConstraintSnapshot,
  PlannerResidualCapacity,
  PlanningComponent,
  PlanningDay,
  PlanningDuration,
  PlanningExperienceCandidate,
  PlanningMobilityConstraints,
  PlanningPolicyVersions,
  PlanningVisitFacts,
  ResolvedCyclingLimits,
  TOUR_PLANNING_FEASIBILITY_VALIDATOR,
  TRAVEL_ESTIMATE_PROVIDER,
} from './daily-planning.interface';
import { singleVisitCandidate } from '../fixtures/planning-input.fixture';

/** Keys of `T` declared optional (`?`). */
type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never;
}[keyof T];

/**
 * Compiles only when `Actual` is exactly `Expected`; `tsc --noEmit` and
 * ts-jest both type-check this file, so a regression fails the build.
 */
type AssertExactly<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : never
  : never;

describe('daily-planning.interface', () => {
  it('exposes string DI tokens', () => {
    expect(DAILY_PLANNING_SOLVER).toBe('DAILY_PLANNING_SOLVER');
    expect(TRAVEL_ESTIMATE_PROVIDER).toBe('TRAVEL_ESTIMATE_PROVIDER');
    expect(TOUR_PLANNING_FEASIBILITY_VALIDATOR).toBe(
      'TOUR_PLANNING_FEASIBILITY_VALIDATOR',
    );
  });

  it('constructs a valid single-place PlanningExperienceCandidate', () => {
    const candidate: PlanningExperienceCandidate = singleVisitCandidate({
      experienceId: 'e1',
      durationMinutes: 60,
    });
    expect(candidate.components[0].visit?.duration.minutes).toBe(60);
  });

  it('keeps the legacy persisted opening-hours shape for the projection only', () => {
    const hours: NormalizedOpeningHours = { status: 'unknown' };
    expect(hours.status).toBe('unknown');
  });

  it('requires every output field the tour-planning spec requires (type-level)', () => {
    // Scheduled activity output: identity, times, incoming leg, duration
    // with provenance, applied opening hours with provenance, binding
    // constraints — none optional.
    const plannedExperience: AssertExactly<
      OptionalKeys<PlannedExperience>,
      never
    > = true;
    const appliedHours: AssertExactly<
      OptionalKeys<AppliedOpeningHours>,
      never
    > = true;
    const duration: AssertExactly<OptionalKeys<PlanningDuration>, never> = true;
    // Day output: used, remaining (with the meaningful judgement), travel,
    // walking, first/last-mile record.
    const plannedDay: AssertExactly<OptionalKeys<PlannedDay>, never> = true;
    const residual: AssertExactly<
      OptionalKeys<PlannerResidualCapacity>,
      never
    > = true;
    // Plan output: input errors, policy versions, estimate quality, legs per
    // mode/quality and the constraint snapshot are required; only
    // solver-specific diagnostics stay optional.
    const solution: AssertExactly<
      OptionalKeys<DailyPlanningSolution>,
      never
    > = true;
    const metadata: AssertExactly<
      OptionalKeys<DailyPlanningSolution['metadata']>,
      'iterations' | 'convergence' | 'capacityDeficits'
    > = true;
    const legs: AssertExactly<OptionalKeys<PlannedLegSummary>, never> = true;
    const snapshot: AssertExactly<
      OptionalKeys<PlannerConstraintSnapshot>,
      never
    > = true;
    expect([
      plannedExperience,
      appliedHours,
      duration,
      plannedDay,
      residual,
      solution,
      metadata,
      legs,
      snapshot,
    ]).toEqual(Array(9).fill(true));
  });

  it('requires the planning input the tour-planning spec requires (type-level)', () => {
    const input: AssertExactly<OptionalKeys<DailyPlanningInput>, never> = true;
    const day: AssertExactly<OptionalKeys<PlanningDay>, never> = true;
    const mobility: AssertExactly<
      OptionalKeys<PlanningMobilityConstraints>,
      never
    > = true;
    const cycling: AssertExactly<
      OptionalKeys<ResolvedCyclingLimits>,
      never
    > = true;
    const policies: AssertExactly<
      OptionalKeys<PlanningPolicyVersions>,
      never
    > = true;
    const component: AssertExactly<
      OptionalKeys<PlanningComponent>,
      never
    > = true;
    const facts: AssertExactly<OptionalKeys<PlanningVisitFacts>, never> = true;
    expect([input, day, mobility, cycling, policies, component, facts]).toEqual(
      Array(7).fill(true),
    );
  });
});
