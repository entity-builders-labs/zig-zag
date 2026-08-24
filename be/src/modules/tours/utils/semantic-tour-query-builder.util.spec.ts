import {
  ExperienceFormat,
  ExplorationStyle,
  TourIntent,
} from '../interfaces/tour-generation.interface';
import { buildSemanticTourQuery } from './semantic-tour-query-builder.util';

describe('buildSemanticTourQuery', () => {
  it('uses semantic intent fields and bounded free text in a stable document', () => {
    const intent: TourIntent = {
      interests: ['history', 'architecture'],
      experienceFormats: [
        ExperienceFormat.POINT_VISITS,
        ExperienceFormat.NEIGHBORHOOD_WALKS,
      ],
      explorationStyle: ExplorationStyle.LOCAL_DEEP_DIVE,
      additionalPreferences: '  modernist buildings and local history  ',
    };

    expect(buildSemanticTourQuery(intent)).toBe(
      [
        'Interests: history, architecture',
        'Experience formats: point visits, neighborhood walks',
        'Exploration style: local deep dive',
        'Additional preferences: modernist buildings and local history',
      ].join('\n'),
    );
  });

  it('does not request semantic ranking without interests or free text', () => {
    expect(
      buildSemanticTourQuery({
        interests: [],
        experienceFormats: [ExperienceFormat.POINT_VISITS],
        explorationStyle: ExplorationStyle.BALANCED,
      }),
    ).toBeNull();
  });
});
