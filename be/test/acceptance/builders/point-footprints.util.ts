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
  /** Canonical within-request preference rank (1 = best). */
  preferenceRank: number;
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
    preferenceRank: spec.preferenceRank,
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

/**
 * Gives each candidate of a pool its position as a distinct preference rank
 * (1 = first). For generated pools, whose order is itself arbitrary.
 */
export function rankByPosition(
  candidates: PlanningExperienceCandidate[],
): PlanningExperienceCandidate[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    preference: { ...candidate.preference, rank: index + 1 },
  }));
}
