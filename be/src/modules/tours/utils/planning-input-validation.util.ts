import {
  DailyPlanningInput,
  PlanningCandidateInputErrorCode,
  PlanningExperienceCandidate,
  PlanningInputError,
  PlanningVisitFacts,
  SpatialFootprint,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';

export interface PlanningInputValidation {
  /** Errors that make the whole request unplannable. */
  requestErrors: PlanningInputError[];
  /** One error per rejected candidate, in input order. */
  candidateErrors: PlanningInputError[];
  /** The candidates that may be planned, in input order. */
  validCandidates: PlanningExperienceCandidate[];
}

/** Raised when the planning request itself is invalid; nothing is planned. */
export class InvalidPlanningInputError extends Error {
  constructor(readonly errors: PlanningInputError[]) {
    super(
      `Invalid planning input: ${errors
        .map((error) => `${error.code}: ${error.detail}`)
        .join('; ')}`,
    );
    this.name = 'InvalidPlanningInputError';
  }
}

const positiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function footprintIsValid(footprint: SpatialFootprint | undefined): boolean {
  return (
    !!footprint &&
    Number.isFinite(footprint.centroid?.lat) &&
    Number.isFinite(footprint.centroid?.lng)
  );
}

function visitFactsError(
  facts: PlanningVisitFacts,
  dayCount: number,
): { code: PlanningCandidateInputErrorCode; detail: string } | null {
  if (!positiveFinite(facts.duration?.minutes) || !facts.duration.provenance) {
    return {
      code: 'MISSING_REQUIRED_DURATION',
      detail: 'visit duration with provenance is required',
    };
  }
  if (facts.openingHoursByDay?.length !== dayCount) {
    return {
      code: 'INVALID_VISIT_FACTS',
      detail: `opening hours cover ${facts.openingHoursByDay?.length ?? 0} of ${dayCount} planning days`,
    };
  }
  return null;
}

function candidateError(
  candidate: PlanningExperienceCandidate,
  dayCount: number,
): { code: PlanningCandidateInputErrorCode; detail: string } | null {
  const components = candidate.components ?? [];
  if (components.length === 0) {
    return { code: 'INVALID_COMPOSITE', detail: 'no component' };
  }
  for (let index = 1; index < components.length; index++) {
    if (!(components[index].order > components[index - 1].order)) {
      return {
        code: 'INVALID_COMPOSITE',
        detail: 'components are not in ascending order',
      };
    }
  }
  if (
    components.some(
      (component) => component.participation !== 'VISIT' && component.visit,
    )
  ) {
    return {
      code: 'INVALID_COMPOSITE',
      detail: 'visit facts on a non-VISIT component',
    };
  }
  const footprints = [
    candidate.spatialFootprint,
    candidate.startFootprint,
    candidate.endFootprint,
    ...components.map((component) => component.footprint),
  ];
  if (!footprints.every(footprintIsValid)) {
    return {
      code: 'INVALID_SPATIAL_FOOTPRINT',
      detail: 'a footprint has no finite coordinates',
    };
  }
  if (candidate.legacyExperienceFacts) {
    return visitFactsError(candidate.legacyExperienceFacts, dayCount);
  }
  const visits = components.filter(
    (component) => component.participation === 'VISIT',
  );
  if (visits.length === 0 || visits.some((component) => !component.visit)) {
    return {
      code: 'MISSING_REQUIRED_DURATION',
      detail: 'every VISIT component needs duration facts',
    };
  }
  for (const component of visits) {
    const error = visitFactsError(component.visit!, dayCount);
    if (error) return error;
  }
  return null;
}

/**
 * The single validation of planner input. Invalid input is reported, never
 * defaulted: an invalid request plans nothing, an invalid candidate is left
 * out with a typed input error and the others are still planned.
 */
export function validatePlanningInput(
  input: DailyPlanningInput,
): PlanningInputValidation {
  const requestErrors: PlanningInputError[] = [];
  const days = input.days ?? [];
  if (
    days.length === 0 ||
    days.some(
      (day, index) =>
        day.dayNumber !== index + 1 ||
        !(
          day.window.endMinutesFromMidnight >
          day.window.startMinutesFromMidnight
        ),
    )
  ) {
    requestErrors.push({
      scope: 'REQUEST',
      code: 'INVALID_PLANNING_DAYS',
      detail: 'days must be numbered 1..n with a non-empty window',
    });
  }
  const cycling = input.mobility.cycling;
  if (
    input.mobility.allowedTransportationModes.includes(
      TransportationMode.CYCLING,
    ) &&
    (!cycling ||
      !positiveFinite(cycling.maxContinuousCyclingMinutes) ||
      !(
        cycling.maxDailyCyclingMinutes === null ||
        positiveFinite(cycling.maxDailyCyclingMinutes)
      ) ||
      !cycling.source)
  ) {
    requestErrors.push({
      scope: 'REQUEST',
      code: 'UNRESOLVED_CYCLING_LIMIT',
      detail: 'cycling is allowed but no resolved cycling limit was supplied',
    });
  }

  const candidateErrors: PlanningInputError[] = [];
  const validCandidates: PlanningExperienceCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    const error = seen.has(candidate.experienceId)
      ? {
          code: 'DUPLICATE_EXPERIENCE' as const,
          detail: 'the same Experience was offered more than once',
        }
      : candidateError(candidate, days.length);
    seen.add(candidate.experienceId);
    if (error) {
      candidateErrors.push({
        scope: 'CANDIDATE',
        experienceId: candidate.experienceId,
        ...error,
      });
    } else {
      validCandidates.push(candidate);
    }
  }
  return { requestErrors, candidateErrors, validCandidates };
}
