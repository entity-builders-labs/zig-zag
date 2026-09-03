import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import {
  buildExperienceFootprint,
  buildOrderedComponentFootprints,
} from '../utils/spatial-footprint.util';

/**
 * Boundary adapter converting ranked, verified Experience records into the
 * planner's native candidate contract. It preserves every required component;
 * request-specific internal routing is intentionally left to the solver because
 * only the solver owns the canonical mobility constraints.
 */
@Injectable()
export class PlanningCandidateNormalizerService {
  constructor(
    @Inject(dailyPlanningPolicyConfig.KEY)
    private readonly policy: ConfigType<typeof dailyPlanningPolicyConfig>,
  ) {}

  async normalizeExperiences(
    experiences: any[],
    scoreBreakdownById: Map<string, CandidateScoreBreakdown>,
  ): Promise<PlanningExperienceCandidate[]> {
    return experiences.map((experience) => {
      const persistedMobility =
        experience.mobility ?? experience.metadata?.mobility;
      const persistedOpeningHours =
        experience.openingHours ?? experience.metadata?.openingHours;
      const scoreBreakdown = scoreBreakdownById.get(experience.id);
      return {
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
        componentFootprints: buildOrderedComponentFootprints(
          experience.components ?? [],
        ),
        semanticScore: scoreBreakdown?.semanticSimilarity ?? 0,
        rankingScore: scoreBreakdown?.totalScore,
        qualityScore: scoreBreakdown?.qualityBonus,
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
        openingHours: persistedOpeningHours,
        metadata: { source: 'experience_catalog' },
      };
    });
  }
}
