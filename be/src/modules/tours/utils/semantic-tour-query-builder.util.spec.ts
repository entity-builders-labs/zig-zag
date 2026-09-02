import {
  ExplorationStyle,
  TourIntent,
} from '../interfaces/tour-generation.interface';
import { buildSemanticTourQuery } from './semantic-tour-query-builder.util';

describe('buildSemanticTourQuery', () => {
  it('uses semantic intent fields and bounded free text in a stable document', () => {
    const intent: TourIntent = {
      interests: ['history', 'architecture'],
      explorationStyle: ExplorationStyle.LOCAL_DEEP_DIVE,
      additionalPreferences: '  modernist buildings and local history  ',
    };

    expect(buildSemanticTourQuery(intent)).toBe(
      [
        'Interests: history, architecture',
        'Exploration style: local deep dive',
        'Additional preferences: modernist buildings and local history',
      ].join('\n'),
    );
  });

  it('does not request semantic ranking without interests or free text', () => {
    expect(
      buildSemanticTourQuery({
        interests: [],
        explorationStyle: ExplorationStyle.BALANCED,
      }),
    ).toBeNull();
  });
});
