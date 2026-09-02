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
    return experiences.map((experience) => ({
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
      semanticScore:
        scoreBreakdownById.get(experience.id)?.semanticSimilarity ?? 0,
      qualityScore: scoreBreakdownById.get(experience.id)?.qualityBonus,
      mobility: experience.mobility
        ? {
            internalWalkingMinutes: experience.mobility.internalWalkingMinutes,
            internalWalkingDistanceMeters:
              experience.mobility.internalWalkingDistanceMeters,
            internalTravelMinutes: experience.mobility.internalTravelMinutes,
            routingProviderCounts: experience.mobility.routingProviderCounts,
            routingFallbackCount: experience.mobility.routingFallbackCount,
          }
        : undefined,
      openingHours: experience.openingHours,
      metadata: { source: 'experience_catalog' },
    }));
  }
}
