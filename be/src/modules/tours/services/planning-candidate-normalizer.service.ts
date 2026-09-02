import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import dailyPlanningPolicyConfig from '../config/daily-planning-policy.config';
import {
  PlanningExperienceCandidate,
} from '../interfaces/daily-planning.interface';
import { CandidateScoreBreakdown } from '../utils/candidate-ranking.util';
import { buildPointFootprint } from '../utils/spatial-footprint.util';


/**
 * Boundary adapter converting ranked, verified Experience records into the
 * planner's native candidate contract. Planning never reads legacy models.
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
      const firstComponent = experience.components?.[0]?.geoEntity ?? experience.components?.[0];
      const latitude = experience.latitude ?? firstComponent?.latitude;
      const longitude = experience.longitude ?? firstComponent?.longitude;
      return {
        experienceId: experience.id,
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
}
