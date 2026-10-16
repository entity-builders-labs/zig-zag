import {
  PlanningPreference,
  PREFERENCE_UTILITY_POLICY_VERSION,
} from '../interfaces/preference-utility.interface';
import { GREEDY_PLANNING_POLICY_VERSIONS } from '../constants/planning-policy-versions';
import {
  DailyPlanningInput,
  DailyPlanningWindow,
  LEGACY_EXPERIENCE_DURATION,
  LEGACY_EXPERIENCE_OPENING_HOURS,
  NormalizedOpeningHours,
  PlanningComponent,
  PlanningComponentParticipation,
  PlanningDay,
  PlanningDayOpeningHours,
  PlanningExperienceCandidate,
  PlanningMobilityConstraints,
  PlanningVisitFacts,
  SpatialFootprint,
} from '../interfaces/daily-planning.interface';
import {
  TransportationMode,
  TravelPace,
} from '../interfaces/tour-generation.interface';
import { legacyOpeningHoursByDay } from '../utils/normalized-opening-hours.util';
import { buildPlanningDays } from '../utils/planning-days.util';

/**
 * Test fixtures speaking the planner contract. Every candidate carries an
 * explicit duration with provenance; nothing here supplies a default the
 * production projection would not.
 */

export const LEGACY_DURATION_PROVENANCE = {
  source: LEGACY_EXPERIENCE_DURATION,
  evidenceBacked: false,
} as const;

export const LEGACY_HOURS_PROVENANCE = {
  source: LEGACY_EXPERIENCE_OPENING_HOURS,
  evidenceBacked: false,
} as const;

export const FIXTURE_WINDOW: DailyPlanningWindow = {
  startMinutesFromMidnight: 540,
  endMinutesFromMidnight: 1200,
};

export function planningDaysFixture(
  count: number,
  options: { startDate?: string; window?: DailyPlanningWindow } = {},
): PlanningDay[] {
  return buildPlanningDays({
    requestedDays: count,
    startDates: options.startDate ? [options.startDate] : [],
    window: options.window ?? FIXTURE_WINDOW,
  });
}

export function unknownHoursByDay(dayCount: number): PlanningDayOpeningHours[] {
  return Array.from({ length: dayCount }, () => ({
    status: 'UNKNOWN' as const,
    provenance: LEGACY_HOURS_PROVENANCE,
  }));
}

/** Legacy weekly hours resolved for concrete planning days. */
export function legacyHoursByDay(
  hours: NormalizedOpeningHours,
  days: PlanningDay[],
): PlanningDayOpeningHours[] {
  return legacyOpeningHoursByDay(hours, days);
}

export function visitFactsFixture(
  durationMinutes: number,
  openingHoursByDay: PlanningDayOpeningHours[] = unknownHoursByDay(1),
): PlanningVisitFacts {
  return {
    duration: {
      minutes: durationMinutes,
      provenance: LEGACY_DURATION_PROVENANCE,
    },
    openingHoursByDay,
  };
}

const point = (lat: number, lng: number): SpatialFootprint => ({
  type: 'POINT',
  centroid: { lat, lng },
});

/**
 * A planner preference at `rank`. The breakdown records no preference
 * signal: the planner orders by rank only and never reads it.
 */
export function planningPreferenceFixture(rank: number): PlanningPreference {
  return {
    policyVersion: PREFERENCE_UTILITY_POLICY_VERSION,
    rank,
    breakdown: {
      directEvidence: 0,
      inferredEvidence: 0,
      avoidance: { directConflict: 0, inferredConflict: 0 },
      softAnchor: false,
      semantic: { status: 'UNKNOWN', reason: 'EMPTY_QUERY' },
      quality: { status: 'UNKNOWN', reason: 'NO_QUALITY_SIGNAL' },
    },
  };
}

interface CandidateFixtureOptions {
  experienceId: string;
  title?: string;
  durationMinutes?: number;
  openingHoursByDay?: PlanningDayOpeningHours[];
  /**
   * The candidate's canonical within-request preference rank (1 = best).
   * Explicit: it is the only preference input the planner orders by.
   */
  preferenceRank: number;
  mustInclude?: boolean;
  mobility?: PlanningExperienceCandidate['mobility'];
}

/** A single-place Experience: one VISIT component holding the facts. */
export function singleVisitCandidate(
  options: CandidateFixtureOptions & {
    footprint?: SpatialFootprint;
    lat?: number;
    lng?: number;
  },
): PlanningExperienceCandidate {
  const footprint =
    options.footprint ?? point(options.lat ?? 0, options.lng ?? 0);
  return {
    experienceId: options.experienceId,
    title: options.title ?? options.experienceId,
    components: [
      {
        order: 0,
        participation: 'VISIT',
        required: true,
        geoEntityId: `geo-${options.experienceId}`,
        footprint,
        visit: visitFactsFixture(
          options.durationMinutes ?? 60,
          options.openingHoursByDay,
        ),
        requiredTraversal: null,
      },
    ],
    legacyExperienceFacts: null,
    spatialFootprint: footprint,
    startFootprint: footprint,
    endFootprint: footprint,
    preference: planningPreferenceFixture(options.preferenceRank),
    mustInclude: options.mustInclude ?? false,
    mobility: options.mobility,
  };
}

/** A legacy composite: facts only for the whole Experience. */
export function legacyCompositeCandidate(
  options: CandidateFixtureOptions & {
    footprints: SpatialFootprint[];
    participations?: Array<PlanningComponentParticipation | null>;
    spatialFootprint?: SpatialFootprint;
  },
): PlanningExperienceCandidate {
  const components = options.footprints.map(
    (footprint, index): PlanningComponent => ({
      order: index,
      participation: options.participations?.[index] ?? ('VISIT' as const),
      required: true,
      geoEntityId: `geo-${options.experienceId}-${index}`,
      footprint,
      visit: null,
      requiredTraversal: null,
    }),
  );
  const spatialFootprint =
    options.spatialFootprint ?? options.footprints[0] ?? point(0, 0);
  return {
    experienceId: options.experienceId,
    title: options.title ?? options.experienceId,
    components,
    legacyExperienceFacts: visitFactsFixture(
      options.durationMinutes ?? 60,
      options.openingHoursByDay,
    ),
    spatialFootprint,
    startFootprint:
      options.footprints.length >= 2 ? options.footprints[0] : spatialFootprint,
    endFootprint:
      options.footprints.length >= 2
        ? options.footprints[options.footprints.length - 1]
        : spatialFootprint,
    preference: planningPreferenceFixture(options.preferenceRank),
    mustInclude: options.mustInclude ?? false,
    mobility: options.mobility,
  };
}

/** Replaces a candidate's visit facts (single-place or legacy composite). */
export function withVisitFacts(
  candidate: PlanningExperienceCandidate,
  patch: {
    durationMinutes?: number;
    openingHoursByDay?: PlanningDayOpeningHours[];
  },
): PlanningExperienceCandidate {
  const patchFacts = (facts: PlanningVisitFacts): PlanningVisitFacts => ({
    duration:
      patch.durationMinutes === undefined
        ? facts.duration
        : { ...facts.duration, minutes: patch.durationMinutes },
    openingHoursByDay: patch.openingHoursByDay ?? facts.openingHoursByDay,
  });
  if (candidate.legacyExperienceFacts) {
    return {
      ...candidate,
      legacyExperienceFacts: patchFacts(candidate.legacyExperienceFacts),
    };
  }
  return {
    ...candidate,
    components: candidate.components.map((component) =>
      component.visit
        ? { ...component, visit: patchFacts(component.visit) }
        : component,
    ),
  };
}

/**
 * Sizes UNKNOWN-only opening hours to the request's days, so a fixture
 * candidate built without knowing the day count stays valid. Known hours are
 * never stretched: a mismatch there is a fixture error and throws.
 */
export function alignUnknownHours(
  candidate: PlanningExperienceCandidate,
  dayCount: number,
): PlanningExperienceCandidate {
  const align = (facts: PlanningVisitFacts): PlanningVisitFacts => {
    if (facts.openingHoursByDay.length === dayCount) return facts;
    if (facts.openingHoursByDay.some((hours) => hours.status !== 'UNKNOWN')) {
      throw new Error(
        `fixture ${candidate.experienceId}: known opening hours for ${facts.openingHoursByDay.length} days, request has ${dayCount}`,
      );
    }
    return { ...facts, openingHoursByDay: unknownHoursByDay(dayCount) };
  };
  return candidate.legacyExperienceFacts
    ? {
        ...candidate,
        legacyExperienceFacts: align(candidate.legacyExperienceFacts),
      }
    : {
        ...candidate,
        components: candidate.components.map((component) =>
          component.visit
            ? { ...component, visit: align(component.visit) }
            : component,
        ),
      };
}

export function mobilityFixture(
  overrides: Partial<PlanningMobilityConstraints> = {},
): PlanningMobilityConstraints {
  return {
    allowedTransportationModes: [TransportationMode.WALKING],
    maxWalkingDistancePerDayMeters: 10000,
    maxContinuousWalkingDistanceMeters: 3000,
    cycling: null,
    ...overrides,
  };
}

export function planningInputFixture(
  overrides: Partial<DailyPlanningInput> & { dayCount?: number } = {},
): DailyPlanningInput {
  const { dayCount, ...rest } = overrides;
  const days = rest.days ?? planningDaysFixture(dayCount ?? 2);
  return {
    days,
    candidates: (rest.candidates ?? []).map((candidate) =>
      alignUnknownHours(candidate, days.length),
    ),
    mobility: rest.mobility ?? mobilityFixture(),
    travelPace: rest.travelPace ?? TravelPace.MODERATE,
    policies: rest.policies ?? GREEDY_PLANNING_POLICY_VERSIONS,
  };
}
