import { ExperienceCompositionService } from './experience-composition.service';
import { ExperienceGenerationService } from './experience-generation.service';
import { PreferenceSpec } from '../interfaces/preference-spec.interface';
import { filterOverlappingExperienceCandidates } from '../utils/candidate-overlap-filter.util';

function experience(id: string, qualityScore: number) {
  return {
    id,
    canonicalName: id,
    themes: ['history'],
    qualityScore,
    components: [
      {
        geoEntity: {
          name: 'Plaza Dorrego',
          latitude: -34.6204917,
          longitude: -58.3717807,
        },
      },
    ],
  };
}

const preferenceSpec: PreferenceSpec = {
  facets: [
    {
      dimension: 'theme',
      key: 'history',
      weight: 1,
      source: 'wizard',
      required: false,
    },
  ],
  exclusions: { themes: [], traits: [], hard: [] },
  anchors: [],
  semanticQuery: '',
  explorationStyle: 'balanced',
  softConstraints: {
    dietary: [],
    accessibility: [],
    budget: [],
    group: [],
  },
  trip: { days: 1, startDates: [], pace: 'moderate' },
};

describe('ExperienceGenerationService composition/overlap handoff', () => {
  it('preserves composition ordering when equal preference weights overlap', async () => {
    const later = experience('A-later', 4);
    const earlier = experience('B-earlier', 5);
    const compositionService = new ExperienceCompositionService({
      getSimilarityScores: jest.fn(),
    } as any);
    const generationService = Object.assign(
      Object.create(ExperienceGenerationService.prototype),
      { experienceComposition: compositionService },
    ) as any;

    const selection = await generationService.composeExperiences(
      [later, earlier],
      preferenceSpec,
    );

    expect(selection.experiences.map((candidate: any) => candidate.id)).toEqual(
      ['B-earlier', 'A-later'],
    );
    expect(selection.preferenceWeightById).toEqual(
      new Map([
        ['A-later', 1],
        ['B-earlier', 1],
      ]),
    );

    const overlapResult = filterOverlappingExperienceCandidates(
      selection.experiences.map((candidate: any) => ({
        ...candidate,
        compositionOrderScore: selection.compositionOrderScoreById.get(
          candidate.id,
        ),
      })),
    );

    expect(overlapResult.kept.map((candidate) => candidate.id)).toEqual([
      'B-earlier',
    ]);
    expect(overlapResult.excluded).toEqual([
      {
        id: 'A-later',
        reason: 'REDUNDANT_WITH_OTHER_CANDIDATE',
        overlapsWith: 'B-earlier',
      },
    ]);
  });
});
