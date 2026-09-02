import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import { PlanningExperienceCandidate } from '../interfaces/daily-planning.interface';
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
      semanticScore:
        scoreBreakdownById.get(experience.id)?.semanticSimilarity ?? 0,
      qualityScore: scoreBreakdownById.get(experience.id)?.qualityBonus,
      mobility: experience.mobility
        ? {
            internalWalkingMinutes: experience.mobility.internalWalkingMinutes,
            internalWalkingDistanceMeters:
              experience.mobility.internalWalkingDistanceMeters,
            internalTravelMinutes: experience.mobility.internalTravelMinutes,
          }
        : undefined,
      openingHours: experience.openingHours,
      metadata: { source: 'experience_catalog' },
    }));
  }
}
