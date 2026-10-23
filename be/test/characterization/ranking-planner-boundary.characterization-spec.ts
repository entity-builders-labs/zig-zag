import { composableExperience } from '../../src/modules/tours/fixtures/composable-experience.fixture';
import { planningDaysFixture } from '../../src/modules/tours/fixtures/planning-input.fixture';
import { PlanningCandidateNormalizerService } from '../../src/modules/tours/services/planning-candidate-normalizer.service';
import { sortCandidatesDeterministically } from '../../src/modules/tours/utils/daily-planning-candidate-sort.util';
import { derivePreferenceUtility } from '../../src/modules/tours/utils/preference-utility.util';
import { PreferenceUtilityResult } from '../../src/modules/tours/interfaces/preference-utility.interface';
import { selectedFacetFixture } from '../../src/modules/tours/fixtures/requested-facet.fixture';

/**
 * CHAR-5 — ranking/planner boundary (task 25.2). The canonical preference
 * utility is derived once; the planner receives only its rank, policy and
 * numeric breakdown, and orders by the rank. No scalar recombination of
 * semantic, facet and quality signals happens at or after the boundary.
 */
const facets = [
  selectedFacetFixture('theme', 'history'),
  selectedFacetFixture('theme', 'art'),
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
    components: [
      {
        geoEntityId: `geo-${id}`,
        role: 'venue',
        geoEntity: { latitude: -34.6, longitude: -58.38 },
      },
    ],
  };
}

function utility(
  experiences: ReturnType<typeof experience>[],
  similarity: Record<string, number>,
): PreferenceUtilityResult {
  return {
    ...derivePreferenceUtility({
      experiences: experiences.map(composableExperience),
      preferenceSpec: { facets, assertions: [] },
      softAnchorIds: new Set(),
      semantic: {
        status: 'applied',
        scores: new Map(Object.entries(similarity)),
        requestedCandidateCount: experiences.length,
        indexedCandidateCount: Object.keys(similarity).length,
        identity: {
          provider: 'ollama',
          model: 'test',
          dimensions: 2,
          documentVersion: 1,
        },
      },
    }),
    semanticRanking: {
      status: 'applied',
      requestedCandidateCount: experiences.length,
      indexedCandidateCount: Object.keys(similarity).length,
    },
  };
}

describe('CHAR-5 ranking/planner boundary', () => {
  it('preserves strong canonical preference through the planner boundary against semantic and quality', () => {
    const a = experience('A-strong-pref', ['history', 'art'], 3);
    const b = experience('B-weaker-pref', ['art'], 5);
    const result = utility([a, b], {
      'A-strong-pref': 0.1,
      'B-weaker-pref': 0.99,
    });
    expect(
      [a.id, b.id].map((id) => result.byId.get(id)!.breakdown.directEvidence),
    ).toEqual([2, 1]);

    const normalized =
      new PlanningCandidateNormalizerService().normalizeExperiences(
        [b, a],
        result,
        { days: planningDaysFixture(1) },
      ).candidates;

    expect(
      sortCandidatesDeterministically(normalized).map((c) => c.experienceId),
    ).toEqual(['A-strong-pref', 'B-weaker-pref']);
  });

  it('carries no ordinal or untyped score across the boundary', () => {
    const candidate = experience('typed', ['history'], 4);
    const [normalized] =
      new PlanningCandidateNormalizerService().normalizeExperiences(
        [candidate],
        utility([candidate], { typed: 0.2 }),
        { days: planningDaysFixture(1) },
      ).candidates;
    for (const field of [
      'rankingScore',
      'semanticScore',
      'qualityScore',
      'preferenceWeight',
    ]) {
      expect(field in normalized).toBe(false);
    }
    expect(normalized.preference).toEqual({
      policyVersion: 'preference-utility-v2',
      rank: 1,
      breakdown: {
        directEvidence: 1,
        inferredEvidence: 0,
        avoidance: { directConflict: 0, inferredConflict: 0 },
        softAnchor: false,
        semantic: { status: 'KNOWN', similarity: 0.2 },
        quality: { status: 'KNOWN', score: 4 },
      },
    });
  });
});
