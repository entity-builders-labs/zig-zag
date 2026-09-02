import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ActivityKind } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  PlanningExperienceCandidate,
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { buildPointFootprint } from '../utils/spatial-footprint.util';
import { parseOpeningHours } from '../utils/normalized-opening-hours.util';

function isCompositeKind(kind: ActivityKind): boolean {
  return (
    kind === ActivityKind.NEIGHBORHOOD_WALK ||
    kind === ActivityKind.ROUTE ||
    kind === ActivityKind.EXPERIENCE
  );
}


/**
 * Boundary adapter converting ranked, real Prisma `Activity` rows
 * (plus their `CandidateScoreBreakdown`) into `PlanningExperienceCandidate[]`
 * for the daily-planning solver. The only place that touches
 * Prisma directly for planning purposes — a bounded `activityWaypoint`
 * lookup to compute a composite's internal walking distance from its own
 * ordered real waypoints.
 */
@Injectable()
export class PlanningCandidateNormalizerService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TRAVEL_ESTIMATE_PROVIDER)
    private readonly travelEstimateProvider: TravelEstimateProvider,
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async normalize(
    activities: any[],
    scoreBreakdownById: Map<string, CandidateScoreBreakdown>,
  ): Promise<PlanningExperienceCandidate[]> {
    return Promise.all(
      activities.map((activity) =>
        this.normalizeOne(activity, scoreBreakdownById.get(activity.id)),
      ),
    );
  }

  /** Native V2 boundary: normalize verified Experiences without consulting
   * ActivityKind or ActivityWaypoint. Kept alongside the compatibility method
   * until the worker switches its acquisition source completely. */
  async normalizeExperiences(
    experiences: any[],
    scoreBreakdownById: Map<string, CandidateScoreBreakdown>,
  ): Promise<PlanningExperienceCandidate[]> {
    return experiences.map((experience) => {
      const firstComponent = experience.components?.[0]?.geoEntity ?? experience.components?.[0];
      const latitude = experience.latitude ?? firstComponent?.latitude;
      const longitude = experience.longitude ?? firstComponent?.longitude;
      return {
        experienceId: experience.id,
        activityId: experience.id,
        kind: 'POI',
        title: experience.canonicalName ?? experience.name,
        durationMinutes:
          experience.durationMinutes ?? (experience.duration ? experience.duration * 60 : undefined) ??
          this.policy.compositeDefaultDurationMinutes,
        spatialFootprint: buildPointFootprint(
          latitude ?? Number.NaN,
          longitude ?? Number.NaN,
        ),
        semanticScore:
          scoreBreakdownById.get(experience.id)?.semanticSimilarity ?? 0,
        qualityScore: scoreBreakdownById.get(experience.id)?.qualityBonus,
        metadata: { source: 'experience_catalog' },
      };
    });
  }

  private async normalizeOne(
    activity: any,
    scoreBreakdown: CandidateScoreBreakdown | undefined,
  ): Promise<PlanningExperienceCandidate> {
    const kind: ActivityKind = activity.kind ?? ActivityKind.POI;
    const mobility = isCompositeKind(kind)
      ? await this.computeInternalWalking(activity)
      : undefined;

    return {
      experienceId: activity.experienceId ?? activity.id,
      activityId: activity.id,
      kind,
      title: activity.name,
      // Persisted duration is hours — converted once, here, at the
      // normalization boundary. Never mixed with hours downstream.
      durationMinutes: this.resolveDurationMinutes(activity, kind),
      spatialFootprint: buildPointFootprint(
        activity.latitude,
        activity.longitude,
      ),
      openingHours: parseOpeningHours(activity.openingHours?.weekdayText),
      semanticScore: scoreBreakdown?.semanticSimilarity ?? 0,
      qualityScore: scoreBreakdown?.qualityBonus,
      areaId: activity.familyId ?? undefined,
      familyId: activity.familyId ?? undefined,
      variantKey: activity.variantTheme ?? undefined,
      mobility,
      metadata: {
        source: activity.metadata?.placesProvider,
        rating: activity.rating,
        userRatingCount: activity.ratingCount,
      },
    };
  }

  /** Persisted `Activity.duration` is hours. Composites never get it
   * populated anywhere in the codebase (`CompositeActivityService` and
   * `ActivityProposalResolutionService` both leave it `null`), so without a
   * fallback every composite would enter the solver at 0 minutes, costing no
   * daily-time-capacity budget and later persisting a near-zero
   * `TourActivity.duration`. The fallback is a policy constant, mirroring
   * `internalWalking.unknownFallbackMinutes` — deliberately NOT derived from
   * `duration` (that is the very value that is missing) nor from internal
   * walking, which is an independent signal. POIs/AREA keep the plain `?? 0`
   * fallback: a POI always has a real duration in practice. */
  private resolveDurationMinutes(activity: any, kind: ActivityKind): number {
    if (activity.duration == null && isCompositeKind(kind)) {
      return this.policy.compositeDefaultDurationMinutes;
    }
    return (activity.duration ?? 0) * 60;
  }

  private async computeInternalWalking(
    composite: any,
  ): Promise<PlanningExperienceCandidate['mobility']> {
    const waypoints = await this.prisma.activityWaypoint.findMany({
      where: { compositeActivityId: composite.id },
      orderBy: { order: 'asc' },
      include: { waypointActivity: true },
    });

    const resolvable = waypoints.filter(
      (w: any) =>
        w.waypointActivity.latitude != null &&
        w.waypointActivity.longitude != null,
    );

    if (resolvable.length < 2) {
      // Too few resolvable waypoints to estimate a real internal-walking
      // distance — represented as unknown, never a duration-derived guess.
      return {
        internalWalkingMinutes: undefined,
        internalWalkingDistanceMeters: undefined,
        internalTravelMinutes: undefined,
      };
    }

    let totalMinutes = 0;
    let totalMeters = 0;
    for (let i = 0; i < resolvable.length - 1; i++) {
      const from = buildPointFootprint(
        resolvable[i].waypointActivity.latitude,
        resolvable[i].waypointActivity.longitude,
      );
      const to = buildPointFootprint(
        resolvable[i + 1].waypointActivity.latitude,
        resolvable[i + 1].waypointActivity.longitude,
      );
      const estimate = await this.travelEstimateProvider.estimate(from, to, [
        TransportationMode.WALKING,
      ]);
      totalMinutes += estimate.durationMinutes;
      totalMeters += estimate.distanceMeters;
    }

    return {
      internalWalkingMinutes: totalMinutes,
      internalWalkingDistanceMeters: totalMeters,
      internalTravelMinutes: totalMinutes,
    };
  }
}
