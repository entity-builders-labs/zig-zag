import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  PlanningExperienceCandidate,
  TRAVEL_ESTIMATE_PROVIDER,
  TravelEstimateProvider,
} from '../interfaces/daily-planning.interface';
import { TransportationMode } from '../interfaces/tour-generation.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { buildExperienceFootprint } from '../utils/spatial-footprint.util';

/**
 * Boundary adapter converting ranked, verified Experience records into the
 * planner's native candidate contract. Planning never reads legacy models and
 * never reduces a multi-component Experience to an arbitrary first point.
 */
@Injectable()
export class PlanningCandidateNormalizerService {
  constructor(
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
    @Optional()
    @Inject(TRAVEL_ESTIMATE_PROVIDER)
    private readonly travelEstimateProvider?: TravelEstimateProvider,
  ) {}

  async normalizeExperiences(
    experiences: any[],
    scoreBreakdownById: Map<string, CandidateScoreBreakdown>,
    allowedModes: TransportationMode[] = [TransportationMode.WALKING],
  ): Promise<PlanningExperienceCandidate[]> {
    return Promise.all(
      experiences.map(async (experience) => ({
        experienceId: experience.id,
        title: experience.canonicalName ?? experience.name,
        durationMinutes:
          experience.durationMinutes ??
          (experience.duration ? experience.duration * 60 : undefined) ??
          this.policy.compositeDefaultDurationMinutes,
        spatialFootprint: buildExperienceFootprint({
          latitude: experience.latitude,
          longitude: experience.longitude,
          components: experience.components,
        }),
        semanticScore:
          scoreBreakdownById.get(experience.id)?.semanticSimilarity ?? 0,
        qualityScore: scoreBreakdownById.get(experience.id)?.qualityBonus,
        mobility:
          experience.mobility ??
          (await this.calculateInternalMobility(experience, allowedModes)),
        openingHours: experience.openingHours,
        metadata: { source: 'experience_catalog' },
      })),
    );
  }

  private async calculateInternalMobility(
    experience: any,
    allowedModes: TransportationMode[],
  ): Promise<PlanningExperienceCandidate['mobility']> {
    if (!this.travelEstimateProvider) return undefined;
    const components = [...(experience.components ?? [])]
      .filter((component: any) => component.required !== false)
      .sort(
        (left: any, right: any) =>
          (left.order ?? Number.MAX_SAFE_INTEGER) -
          (right.order ?? Number.MAX_SAFE_INTEGER),
      );
    if (components.length < 2) return undefined;

    let internalTravelMinutes = 0;
    let internalWalkingMinutes = 0;
    let internalWalkingDistanceMeters = 0;
    let routingFallbackCount = 0;
    const routingProviderCounts: Record<string, number> = {};

    for (let index = 1; index < components.length; index++) {
      const from = buildExperienceFootprint({ components: [components[index - 1]] });
      const to = buildExperienceFootprint({ components: [components[index]] });
      if (
        !Number.isFinite(from.centroid.lat) ||
        !Number.isFinite(from.centroid.lng) ||
        !Number.isFinite(to.centroid.lat) ||
        !Number.isFinite(to.centroid.lng)
      ) {
        continue;
      }
      const estimate = await this.travelEstimateProvider.estimate(
        from,
        to,
        allowedModes,
      );
      internalTravelMinutes += estimate.durationMinutes;
      internalWalkingMinutes += estimate.walkingMinutes;
      internalWalkingDistanceMeters += estimate.walkingDistanceMeters;
      const provider = estimate.provider ?? 'unknown';
      routingProviderCounts[provider] = (routingProviderCounts[provider] ?? 0) + 1;
      if (estimate.approximate || estimate.fallbackReason) routingFallbackCount++;
    }

    if (Object.keys(routingProviderCounts).length === 0) return undefined;
    return {
      internalTravelMinutes,
      internalWalkingMinutes,
      internalWalkingDistanceMeters,
      routingProviderCounts,
      routingFallbackCount,
    };
  }
}
