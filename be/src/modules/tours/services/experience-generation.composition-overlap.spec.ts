import { ExperienceCompositionService } from './experience-composition.service';
import { PreferenceUtilityService } from './preference-utility.service';
import { ExperienceGenerationService } from './experience-generation.service';
import { PreferenceSpec } from '../interfaces/preference-spec.interface';
import { filterOverlappingExperienceCandidates } from '../utils/candidate-overlap-filter.util';

function experience(id: string, qualityScore: number) {
  return {
    id,
    canonicalName: id,
    themes: ['history'],
    qualityScore,
    // Planning-ready: composition only offers Experiences with a duration.
    durationMinutes: 60,
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
      provenance: 'DIRECT' as const,
      importance: 1,
      confidence: 1,
      evidence: [],
      required: false,
    },
  ],
  assertions: [],
  polarityConflicts: [],
  unresolvedConcepts: [],
  facetSchemaVersion: 'facet-schema-v2',
  anchors: [],
  semanticQuery: '',
  explorationStyle: 'balanced',
  trip: { days: 1, startDates: [], pace: 'moderate' },
};

describe('ExperienceGenerationService composition/overlap handoff', () => {
  it('preserves composition ordering when equal explicit preference overlaps', async () => {
    const later = experience('A-later', 4);
    const earlier = experience('B-earlier', 5);
    const generationService = Object.assign(
      Object.create(ExperienceGenerationService.prototype),
      {
        experienceComposition: new ExperienceCompositionService(),
        // No semantic query: the utility never calls the vector store.
        preferenceUtility: new PreferenceUtilityService({
          getSimilarityScores: jest.fn(),
        } as any),
      },
    ) as any;

    const selection = await generationService.composeExperiences(
      [later, earlier],
      preferenceSpec,
    );

    expect(
      selection.initialExperiences.map((candidate: any) => candidate.id),
    ).toEqual(['B-earlier', 'A-later']);
    // Equal explicit preference: both match the one DIRECT history facet.
    expect(
      ['A-later', 'B-earlier'].map(
        (id) =>
          selection.preferenceUtility.byId.get(id).breakdown.directEvidence,
      ),
    ).toEqual([1, 1]);

    const overlapResult = filterOverlappingExperienceCandidates(
      selection.initialExperiences.map((candidate: any) => ({
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
