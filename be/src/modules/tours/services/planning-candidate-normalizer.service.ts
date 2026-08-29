import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ActivityKind } from '@prisma/client';
import { PrismaService } from '@core/database/prisma.service';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  PlanningActivityCandidate,
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import {
  ExperienceFormat,
  TransportationMode,
} from '../interfaces/tour-generation.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { EXPERIENCE_FORMAT_ACTIVITY_KIND } from '../utils/experience-format-kind.util';
import { buildPointFootprint } from '../utils/spatial-footprint.util';
import { parseOpeningHours } from '../utils/normalized-opening-hours.util';

function isCompositeKind(kind: ActivityKind): boolean {
  return (
    kind === ActivityKind.NEIGHBORHOOD_WALK ||
    kind === ActivityKind.ROUTE ||
    kind === ActivityKind.EXPERIENCE
  );
}

// Inverted from EXPERIENCE_FORMAT_ACTIVITY_KIND (the single source of truth,
// owned by experience-format-kind.util.ts — never redefined here) so a
// real ActivityKind can be mapped back to the ExperienceFormat(s) it
// satisfies without duplicating that data.
const KIND_TO_FORMAT = new Map<ActivityKind, ExperienceFormat>(
  (
    Object.entries(EXPERIENCE_FORMAT_ACTIVITY_KIND) as [
      ExperienceFormat,
      ActivityKind,
    ][]
  ).map(([format, kind]) => [kind, format]),
);

function activityKindToFormats(kind: ActivityKind): ExperienceFormat[] {
  // POINT_VISITS is deliberately absent from EXPERIENCE_FORMAT_ACTIVITY_KIND
  // (see that file's own comment) since POI is the ubiquitous default kind —
  // handled here as the one explicit exception to the inverted lookup.
  if (kind === ActivityKind.POI) return [ExperienceFormat.POINT_VISITS];
  const format = KIND_TO_FORMAT.get(kind);
  return format ? [format] : [];
}

/**
 * Boundary adapter converting PR9's ranked, real Prisma `Activity` rows
 * (plus their `CandidateScoreBreakdown`) into `PlanningActivityCandidate[]`
 * for the daily-planning solver. The only place in this plan that touches
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
  ): Promise<PlanningActivityCandidate[]> {
    return Promise.all(
      activities.map((activity) =>
        this.normalizeOne(activity, scoreBreakdownById.get(activity.id)),
      ),
    );
  }

  private async normalizeOne(
    activity: any,
    scoreBreakdown: CandidateScoreBreakdown | undefined,
  ): Promise<PlanningActivityCandidate> {
    const kind: ActivityKind = activity.kind ?? ActivityKind.POI;
    const mobility = isCompositeKind(kind)
      ? await this.computeInternalWalking(activity)
      : undefined;

    return {
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
      formats: activityKindToFormats(kind),
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
  ): Promise<PlanningActivityCandidate['mobility']> {
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
