import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import { evaluateExperiencePreferences } from './experience-preference-evaluator.util';

const baseIntent: NormalizedPreferenceIntent = {
  preferredThemes: [],
  preferredTraits: [],
  preferredIntents: [],
  excludedThemes: [],
  excludedTraits: [],
  hardExclusions: [],
  softConstraints: [],
  ambiguities: [],
  dietaryPreferences: [],
  accessibilityPreferences: [],
  budgetPreferences: [],
  groupPreferences: [],
  positiveSemanticQuery: '',
  notes: [],
};

describe('hard vs soft Experience preference contract', () => {
  it('keeps soft constraints as score penalties and never as hard exclusions', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Paseo cultural concurrido',
        themes: ['culture'],
        traits: ['crowded'],
      },
      {
        ...baseIntent,
        preferredThemes: ['culture'],
        softConstraints: ['crowded'],
      },
    );

    expect(result.positiveMatches).toContain('culture');
    expect(result.negativeMatches).toContain('crowded');
    expect(result.exclusionMatches).toEqual([]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('records hard exclusions separately so strict selection can reject the candidate', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Arte en la Catedral Metropolitana',
        themes: ['art', 'religion'],
      },
      {
        ...baseIntent,
        preferredThemes: ['art'],
        hardExclusions: ['religion'],
      },
    );

    expect(result.positiveMatches).toContain('art');
    expect(result.exclusionMatches).toContain('religion');
    expect(result.reasons).toContain('exclusion:religion');
  });

  it('does not turn an optional component into a hard exclusion', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Caminata histórica secular',
        themes: ['history'],
        components: [
          {
            required: false,
            role: 'optional_stop',
            geoEntity: {
              name: 'Catedral Metropolitana',
              kind: 'PLACE',
            },
          },
        ],
      },
      {
        ...baseIntent,
        hardExclusions: ['religion'],
      },
    );

    expect(result.exclusionMatches).toEqual([]);
  });

  it('does turn a required component into a hard exclusion', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Caminata histórica',
        themes: ['history'],
        components: [
          {
            required: true,
            role: 'stop',
            geoEntity: {
              name: 'Catedral Metropolitana',
              kind: 'PLACE',
            },
          },
        ],
      },
      {
        ...baseIntent,
        hardExclusions: ['religion'],
      },
    );

    expect(result.exclusionMatches).toContain('religion');
  });
});
