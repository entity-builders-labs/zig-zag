import {
  NormalizedOpeningHours,
  PlanningDay,
  PlanningExperienceCandidate,
  SpatialFootprint,
} from 'src/modules/tours/interfaces/daily-planning.interface';
import {
  alignUnknownHours,
  legacyHoursByDay,
  singleVisitCandidate,
  withVisitFacts,
} from 'src/modules/tours/fixtures/planning-input.fixture';

/** The planner-relevant fields acceptance fixtures describe a place with. */
export interface AcceptanceCandidateSpec {
  experienceId: string;
  title: string;
  durationMinutes: number;
  semanticScore: number;
  qualityScore?: number;
  spatialFootprint: SpatialFootprint;
  /** Legacy weekly hours; resolved per planning day by `TourInputBuilder`. */
  openingHours?: NormalizedOpeningHours;
}

/**
 * Weekly hours of acceptance candidates, kept until the request's planning
 * days are known. Test-only: the planner itself only sees per-day knowledge.
 */
const weeklyHoursByCandidate = new WeakMap<
  PlanningExperienceCandidate,
  NormalizedOpeningHours
>();

/**
 * A point-shaped single-place planning candidate: one VISIT component whose
 * facts are the Experience's, and start/end footprints collapsed to its
 * single `spatialFootprint` — exactly what `PlanningCandidateNormalizerService`
 * derives for a one-component Experience.
 */
export function toPointCandidate(
  spec: AcceptanceCandidateSpec,
): PlanningExperienceCandidate {
  const candidate = singleVisitCandidate({
    experienceId: spec.experienceId,
    title: spec.title,
    durationMinutes: spec.durationMinutes,
    semanticScore: spec.semanticScore,
    qualityScore: spec.qualityScore,
    footprint: spec.spatialFootprint,
  });
  if (spec.openingHours) {
    weeklyHoursByCandidate.set(candidate, spec.openingHours);
  }
  return candidate;
}

/** Resolves a candidate's opening hours for the request's planning days. */
export function resolveForDays(
  candidate: PlanningExperienceCandidate,
  days: PlanningDay[],
): PlanningExperienceCandidate {
  const weekly = weeklyHoursByCandidate.get(candidate);
  return weekly
    ? withVisitFacts(candidate, {
        openingHoursByDay: legacyHoursByDay(weekly, days),
      })
    : alignUnknownHours(candidate, days.length);
}
