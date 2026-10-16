import { composableExperience } from '../fixtures/composable-experience.fixture';
import { ExperienceCompositionService } from './experience-composition.service';
import { PreferenceSpec } from '../interfaces/preference-spec.interface';
import { derivePreferenceUtility } from '../utils/preference-utility.util';

const preferenceSpec: PreferenceSpec = {
  facets: [],
  assertions: [],
  polarityConflicts: [],
  supersededAssertions: [],
  unresolvedConcepts: [],
  facetSchemaVersion: 'facet-schema-v2',
  anchors: [],
  semanticQuery: '',
  explorationStyle: 'balanced',
  trip: { days: 1, startDates: [], pace: 'moderate' },
};

const component = (name: string) => ({
  geoEntity: { name, kind: 'PLACE', latitude: 1, longitude: 2 },
});

describe('ExperienceCompositionService (consumer of the preference utility)', () => {
  const service = new ExperienceCompositionService();

  it('orders composition by the canonical utility it receives, never re-deriving it', () => {
    const experiences = [
      composableExperience({
        id: 'a-low-quality',
        components: [component('A')],
        qualityScore: 3,
      }),
      composableExperience({
        id: 'b-high-quality',
        components: [component('B')],
        qualityScore: 5,
      }),
    ];
    const preferenceUtility = {
      ...derivePreferenceUtility({
        experiences,
        preferenceSpec,
        softAnchorIds: new Set(),
        semantic: null,
      }),
      semanticRanking: {
        status: 'not_requested' as const,
        requestedCandidateCount: 0,
        indexedCandidateCount: 0,
      },
    };

    const output = service.compose({
      experiences,
      preferenceSpec,
      preferenceUtility,
    });

    expect(output.result.selected).toEqual(['b-high-quality', 'a-low-quality']);
    expect(output.candidatesById.has('a-low-quality')).toBe(true);
  });

  it('fails explicitly when an Experience has no preference-utility assessment', () => {
    expect(() =>
      service.compose({
        experiences: [
          composableExperience({ id: 'orphan', components: [component('O')] }),
        ],
        preferenceSpec,
        preferenceUtility: {
          policyVersion: 'preference-utility-v1',
          order: [],
          byId: new Map(),
          semanticRanking: {
            status: 'not_requested',
            requestedCandidateCount: 0,
            indexedCandidateCount: 0,
          },
        },
      }),
    ).toThrow(/without a preference-utility assessment/);
  });
});
