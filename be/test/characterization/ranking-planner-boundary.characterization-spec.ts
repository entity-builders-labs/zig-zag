import { CandidateScoreBreakdown } from '../../src/modules/tours/utils/candidate-ranking.util';
import { PlanningCandidateNormalizerService } from '../../src/modules/tours/services/planning-candidate-normalizer.service';
import dailyPlanningPolicyConfig from '../../src/modules/tours/config/daily-planning-policy.config';
import { sortCandidatesDeterministically } from '../../src/modules/tours/utils/daily-planning-candidate-sort.util';
import { scoreCandidateForDay } from '../../src/modules/tours/utils/daily-planning-placement.util';
import { preferenceWeightForExperience } from '../../src/modules/tours/utils/preference-facet-matching.util';
import { RequestedFacet } from '../../src/modules/tours/interfaces/preference-spec.interface';

const facets: RequestedFacet[] = [
  {
    dimension: 'theme',
    key: 'history',
    weight: 1,
    source: 'wizard',
    required: false,
  },
  {
    dimension: 'theme',
    key: 'art',
    weight: 1,
    source: 'wizard',
    required: false,
  },
];

function experience(id: string, themes: string[], qualityScore: number) {
  return {
    id,
    canonicalName: id,
    durationMinutes: 90,
    latitude: -34.6,
    longitude: -58.38,
    themes,
    qualityScore,
    components: [{ geoEntity: { latitude: -34.6, longitude: -58.38 } }],
  };
}

describe('CHAR-5 ranking/planner boundary', () => {
  it('preserves strong canonical preference through the planner boundary', async () => {
    const a = experience('A-strong-pref', ['history', 'art'], 3);
    const b = experience('B-weaker-pref', ['art'], 5);
    const weights = new Map([
      [a.id, preferenceWeightForExperience(a, facets)],
      [b.id, preferenceWeightForExperience(b, facets)],
    ]);
    expect(weights).toEqual(
      new Map([
        ['A-strong-pref', 2],
        ['B-weaker-pref', 1],
      ]),
    );

    const normalizer = new PlanningCandidateNormalizerService(
      dailyPlanningPolicyConfig(),
    );
    const normalized = await normalizer.normalizeExperiences(
      [a, b],
      new Map<string, CandidateScoreBreakdown>([
        [
          'A-strong-pref',
          {
            semanticSimilarity: 0.99,
            qualityBonus: 0,
            diversityBonus: 0,
            proximityBonus: 0,
            totalScore: 999,
          },
        ],
        [
          'B-weaker-pref',
          {
            semanticSimilarity: 0,
            qualityBonus: 0,
            diversityBonus: 0,
            proximityBonus: 0,
            totalScore: 1000,
          },
        ],
      ]),
      { preferenceWeightById: weights },
    );

    expect(
      sortCandidatesDeterministically(normalized).map((c) => c.experienceId),
    ).toEqual(['A-strong-pref', 'B-weaker-pref']);
    const policy = dailyPlanningPolicyConfig();
    const context: any = { policy };
    const emptyDay: any = { dayNumber: 1, assigned: [] };
    expect(
      scoreCandidateForDay(normalized[0], emptyDay, context),
    ).toBeGreaterThan(scoreCandidateForDay(normalized[1], emptyDay, context));
  });

  it('does not let an ordinal rankingScore override typed planner signals', async () => {
    const candidate = experience('typed', ['history'], 4);
    const normalizer = new PlanningCandidateNormalizerService(
      dailyPlanningPolicyConfig(),
    );
    const [normalized] = await normalizer.normalizeExperiences(
      [candidate],
      new Map([
        [
          'typed',
          {
            semanticSimilarity: 0.2,
            qualityBonus: 0,
            diversityBonus: 0,
            proximityBonus: 0,
            totalScore: 999,
          } as CandidateScoreBreakdown,
        ],
      ]),
      { preferenceWeightById: new Map([['typed', 1]]) },
    );
    expect('rankingScore' in normalized).toBe(false);
    expect(normalized.preferenceWeight).toBe(1);
    expect(
      scoreCandidateForDay(
        normalized,
        { dayNumber: 1, assigned: [] } as any,
        { policy: dailyPlanningPolicyConfig() } as any,
      ),
    ).toBeCloseTo(1.85);
  });
});
