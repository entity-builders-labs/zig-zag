import { evaluateExperiencePreferences } from './experience-preference-evaluator.util';

const emptyIntent = {
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

describe('evaluateExperiencePreferences', () => {
  it('detects a religious exclusion in a required component even when the Experience name is neutral', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Paseo por el casco histórico',
        themes: ['history', 'architecture'],
        components: [
          {
            role: 'stop',
            required: true,
            geoEntity: {
              name: 'Catedral Metropolitana',
              kind: 'PLACE',
            },
          },
        ],
      },
      { ...emptyIntent, hardExclusions: ['religion'] },
    );

    expect(result.exclusionMatches).toContain('religion');
  });

  it('detects incompatible non-vegan food from explicit traits', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Sabores porteños',
        themes: ['food'],
        traits: ['parrilla', 'meat'],
      },
      {
        ...emptyIntent,
        dietaryPreferences: ['vegan'],
        hardExclusions: ['non-vegan food'],
      },
    );

    expect(result.exclusionMatches).toContain('non-vegan food');
  });

  it('rewards explicit accessibility suitability deterministically', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Museo accesible',
        traits: ['wheelchair accessible', 'step-free'],
      },
      { ...emptyIntent, accessibilityPreferences: ['accessibility'] },
    );

    expect(result.positiveMatches).toContain('accessibility');
    expect(result.score).toBeGreaterThan(0);
  });
});
