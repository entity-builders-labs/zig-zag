import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import { evaluateExperiencePreferences } from './experience-preference-evaluator.util';

const emptyIntent: NormalizedPreferenceIntent = {
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

  it('does not infer non-vegan food from the generic food intent', () => {
    const result = evaluateExperiencePreferences(
      {
        canonicalName: 'Bocados veganos económicos',
        description: 'Gastronomía vegana plant based, económica y compacta.',
        themes: ['gastronomy'],
        traits: ['vegan', 'low budget', 'plant based'],
        intents: ['food'],
        metadata: { budgetLevel: 'low' },
      },
      {
        ...emptyIntent,
        preferredThemes: ['gastronomy'],
        preferredTraits: ['vegan'],
        dietaryPreferences: ['vegan'],
        budgetPreferences: ['low budget'],
        hardExclusions: ['non-vegan food'],
      },
    );

    expect(result.exclusionMatches).toEqual([]);
    expect(result.score).toBe(1);
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
