import { Injectable } from '@nestjs/common';
import {
  LEGACY_EXPERIENCE_DURATION,
  PlanningComponent,
  PlanningComponentParticipation,
  PlanningDay,
  PlanningExperienceCandidate,
  PlanningVisitFacts,
} from '../interfaces/daily-planning.interface';
import { PreferenceUtilityResult } from '../interfaces/preference-utility.interface';
import {
  geoEntityOpeningHoursByDay,
  legacyOpeningHoursByDay,
} from '../utils/normalized-opening-hours.util';
import {
  buildExperienceFootprint,
  buildOrderedComponentsWithFootprints,
  ComponentLike,
} from '../utils/spatial-footprint.util';

/**
 * Why a catalogued Experience is not planning-ready. A catalogued Experience
 * is not necessarily a planning-ready one: it stays in the catalog, keeps
 * its identity, and becomes planning-ready again once its missing knowledge
 * is enriched (the enrichment-demand wiring of task 41.0).
 */
export type PlanningIneligibilityReason = 'MISSING_REQUIRED_DURATION';

export interface PlanningIneligibleExperience {
  experienceId: string;
  reason: PlanningIneligibilityReason;
}

/** Internal-routing figures a legacy Experience may persist. */
interface PersistedInternalMobility {
  internalWalkingMinutes?: number;
  internalWalkingDistanceMeters?: number;
  maxInternalContinuousWalkingDistanceMeters?: number;
  internalTravelMinutes?: number;
  routingProviderCounts?: Record<string, number>;
  routingFallbackCount?: number;
}

/** The legacy Experience fields the transitional projection reads. */
export interface PlanningProjectableExperience {
  id: string;
  name?: string | null;
  canonicalName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  durationMinutes?: number | null;
  compositionSignature?: string | null;
  openingHours?: unknown;
  metadata?: {
    mobility?: PersistedInternalMobility;
    [key: string]: unknown;
  } | null;
  mobility?: PersistedInternalMobility;
  components?: Array<
    ComponentLike & {
      geoEntityId?: string | null;
      required?: boolean | null;
      participation?: PlanningComponentParticipation | null;
      geoEntity?:
        | (ComponentLike['geoEntity'] & {
            visitDuration?: {
              status: string;
              typicalMinutes: number | null;
              authorityClass: string | null;
              evidenceQuality: string | null;
              evidence: unknown;
              resolverVersion: string;
              resolvedAt: Date | string;
            } | null;
            openingHours?: {
              status: string;
              timezone: string | null;
              schedule: unknown;
              scheduleVersion: number | null;
              source: string;
              sourceRecordRef: string | null;
              parserVersion: string | null;
              retrievedAt: Date | string;
            } | null;
          })
        | null;
    }
  >;
}

export interface PlanningCandidateNormalizationContext {
  /** The request's planning days; per-day facts are resolved against them. */
  days: PlanningDay[];
  mustIncludeExperienceIds?: ReadonlySet<string>;
}

/**
 * Participation of a legacy component, from its `role` (design C14,
 * "Participation migration strategy"): `venue`/`waypoint` → VISIT, `route` →
 * TRAVERSE (unbounded), anything else (`area`) → no participation yet.
 */
const LEGACY_ROLE_PARTICIPATION: Record<
  string,
  PlanningComponentParticipation
> = {
  venue: 'VISIT',
  waypoint: 'VISIT',
  route: 'TRAVERSE',
};

/**
 * The only usable duration of a legacy Experience is its own
 * `durationMinutes`. An absent duration gets no synthetic value: the
 * Experience is not planning-ready (owner, 2026-10-15). The evidence-backed
 * `fallback-v1` of task 40.2 is a different, future policy.
 */
function usableLegacyDurationMinutes(
  experience: PlanningProjectableExperience,
): number | null {
  const minutes = experience.durationMinutes;
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
    ? minutes
    : null;
}

function structuredSinglePlaceComponent(
  experience: PlanningProjectableExperience,
) {
  if (!experience.compositionSignature?.startsWith('v1:')) return undefined;
  const components = experience.components ?? [];
  if (
    components.length !== 1 ||
    components[0].participation !== 'VISIT' ||
    !components[0].geoEntityId
  ) {
    return undefined;
  }
  return components[0];
}

function usableStructuredDurationMinutes(
  experience: PlanningProjectableExperience,
): number | null {
  const duration =
    structuredSinglePlaceComponent(experience)?.geoEntity?.visitDuration;
  if (
    duration?.status !== 'RESOLVED' ||
    typeof duration.typicalMinutes !== 'number' ||
    !Number.isFinite(duration.typicalMinutes) ||
    duration.typicalMinutes <= 0
  ) {
    return null;
  }
  return duration.typicalMinutes;
}

function usableDurationMinutes(
  experience: PlanningProjectableExperience,
): number | null {
  return structuredSinglePlaceComponent(experience)
    ? usableStructuredDurationMinutes(experience)
    : usableLegacyDurationMinutes(experience);
}

/** Splits catalogued Experiences into planning-ready ones and the others. */
export function partitionPlanningReady<T extends PlanningProjectableExperience>(
  experiences: T[],
): { ready: T[]; ineligible: PlanningIneligibleExperience[] } {
  const ready: T[] = [];
  const ineligible: PlanningIneligibleExperience[] = [];
  for (const experience of experiences) {
    if (usableDurationMinutes(experience) === null) {
      ineligible.push({
        experienceId: experience.id,
        reason: 'MISSING_REQUIRED_DURATION',
      });
    } else {
      ready.push(experience);
    }
  }
  return { ready, ineligible };
}

/**
 * Boundary adapter converting ranked, verified Experience records into the
 * planner's native candidate contract. Until group 41 wires evidence-backed
 * GeoEntity knowledge, its facts come from the legacy Experience pipeline and
 * carry `LEGACY_EXPERIENCE_*` provenance (never evidence). Request-specific
 * internal routing is left to the solver, which owns the mobility
 * constraints.
 */
@Injectable()
export class PlanningCandidateNormalizerService {
  normalizeExperiences(
    experiences: PlanningProjectableExperience[],
    preferenceUtility: PreferenceUtilityResult,
    context: PlanningCandidateNormalizationContext,
  ): {
    candidates: PlanningExperienceCandidate[];
    ineligible: PlanningIneligibleExperience[];
  } {
    const { ready, ineligible } = partitionPlanningReady(experiences);
    return {
      candidates: ready.map((experience) =>
        this.toCandidate(experience, preferenceUtility, context),
      ),
      ineligible,
    };
  }

  private toCandidate(
    experience: PlanningProjectableExperience,
    preferenceUtility: PreferenceUtilityResult,
    context: PlanningCandidateNormalizationContext,
  ): PlanningExperienceCandidate {
    const persistedMobility =
      experience.mobility ?? experience.metadata?.mobility;
    const structuredComponent = structuredSinglePlaceComponent(experience);
    const structuredDuration = structuredComponent?.geoEntity?.visitDuration;
    const structuredHours = structuredComponent?.geoEntity?.openingHours;
    const durationMinutes = structuredComponent
      ? usableStructuredDurationMinutes(experience)
      : usableLegacyDurationMinutes(experience);
    // Opening-hours decisions use typed Experience or GeoEntity knowledge;
    // metadata is not a planning authority.
    const facts: PlanningVisitFacts = {
      duration: {
        minutes: durationMinutes!,
        provenance:
          structuredComponent && structuredDuration
            ? {
                source: 'GEO_ENTITY_VISIT_DURATION',
                evidenceBacked: true,
                geoEntityId: structuredComponent.geoEntityId!,
                authorityClass: structuredDuration.authorityClass,
                evidenceQuality: structuredDuration.evidenceQuality,
                evidence: structuredDuration.evidence,
                resolverVersion: structuredDuration.resolverVersion,
                resolvedAt: new Date(
                  structuredDuration.resolvedAt,
                ).toISOString(),
              }
            : {
                source: LEGACY_EXPERIENCE_DURATION,
                evidenceBacked: false,
              },
      },
      openingHoursByDay: structuredComponent
        ? geoEntityOpeningHoursByDay(
            structuredComponent.geoEntityId!,
            structuredHours ?? null,
            context.days,
          )
        : legacyOpeningHoursByDay(experience.openingHours, context.days),
    };
    const ordered = buildOrderedComponentsWithFootprints(
      (experience.components ?? []).filter(
        (component) => !!component.geoEntityId,
      ),
    );
    // A single-place Experience's facts are its one VISIT component's facts;
    // a legacy composite holds them only for the whole Experience.
    const singleVisit =
      ordered.length === 1 &&
      (structuredComponent
        ? true
        : LEGACY_ROLE_PARTICIPATION[ordered[0].component.role ?? ''] ===
          'VISIT');
    const components: PlanningComponent[] = ordered.map(
      ({ component, footprint }, index): PlanningComponent => {
        const participation =
          component.participation ??
          LEGACY_ROLE_PARTICIPATION[component.role ?? ''] ??
          null;
        return {
          order: index,
          participation,
          required: component.required !== false,
          geoEntityId: component.geoEntityId!,
          footprint,
          visit: singleVisit ? facts : null,
          requiredTraversal: null,
        };
      },
    );
    const spatialFootprint = buildExperienceFootprint({
      latitude: experience.latitude,
      longitude: experience.longitude,
      components: experience.components,
    });
    // Derived once here so the solver's hot loops never need a fallback —
    // a single-component Experience's start/end both collapse to its one
    // generic footprint.
    const startFootprint =
      components.length >= 2 ? components[0].footprint : spatialFootprint;
    const endFootprint =
      components.length >= 2
        ? components[components.length - 1].footprint
        : spatialFootprint;
    // Every planned Experience carries its canonical preference; a missing
    // assessment is a pipeline error, never a default rank.
    const preference = preferenceUtility.byId.get(experience.id);
    if (!preference) {
      throw new Error(
        `Experience ${experience.id} reached planning without a preference-utility assessment`,
      );
    }
    return {
      experienceId: experience.id,
      title: experience.canonicalName ?? experience.name ?? experience.id,
      components,
      legacyExperienceFacts: singleVisit ? null : facts,
      spatialFootprint,
      startFootprint,
      endFootprint,
      preference: {
        policyVersion: preferenceUtility.policyVersion,
        rank: preference.rank,
        breakdown: preference.breakdown,
      },
      mustInclude:
        context.mustIncludeExperienceIds?.has(experience.id) ?? false,
      mobility: persistedMobility
        ? {
            internalWalkingMinutes: persistedMobility.internalWalkingMinutes,
            internalWalkingDistanceMeters:
              persistedMobility.internalWalkingDistanceMeters,
            maxInternalContinuousWalkingDistanceMeters:
              persistedMobility.maxInternalContinuousWalkingDistanceMeters,
            internalTravelMinutes: persistedMobility.internalTravelMinutes,
            routingProviderCounts: persistedMobility.routingProviderCounts,
            routingFallbackCount: persistedMobility.routingFallbackCount,
          }
        : undefined,
    };
  }
}
