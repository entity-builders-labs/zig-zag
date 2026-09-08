import { NormalizedPreferenceIntent } from '../interfaces/preference-interpretation.interface';
import {
  evaluateExperiencePreferences,
  PreferenceFacetMatch,
} from './experience-preference-evaluator.util';
import { normalizeWizardFacet } from './preference-facet-merge.util';

const emptyIntent: NormalizedPreferenceIntent = {
  preferredFacets: [],
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
        preferredFacets: [
          normalizeWizardFacet('theme', 'gastronomy'),
          normalizeWizardFacet('trait', 'vegan'),
        ],
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

  describe('mathematical equivalence regression when all facets have importance=1 and confidence=1', () => {
    it('produces exact identical scoring for mixed themes, traits, intents, dietary, budget, and soft negatives', () => {
      const exp = {
        canonicalName: 'Visita guiada histórica y cata de vino',
        themes: ['history', 'wine'],
        traits: ['guided', 'accessible', 'low budget'],
        intents: ['visit', 'walk'],
        metadata: { budgetLevel: 'low' },
      };

      // Legacy simulation:
      // preferred = ['history', 'art', 'guided', 'boutique', 'visit', 'cycling', 'low budget', 'accessible'] (8 items)
      // matches: history, guided, visit, low budget, accessible (5 items) -> positiveRatio = 5/8 = 0.625
      // negative = ['crowded'] (0 matches) -> negativePenalty = 0
      // exclusion = [] -> 0
      // expected score = 0.625

      const intent: NormalizedPreferenceIntent = {
        ...emptyIntent,
        preferredFacets: [
          normalizeWizardFacet('theme', 'history'),
          normalizeWizardFacet('theme', 'art'), // not matched
          normalizeWizardFacet('trait', 'guided'),
          normalizeWizardFacet('trait', 'boutique'), // not matched
          normalizeWizardFacet('intent', 'visit'),
          normalizeWizardFacet('intent', 'cycling'), // not matched
        ],
        budgetPreferences: ['low budget'],
        accessibilityPreferences: ['accessible'],
        softConstraints: ['crowded'],
      };

      const result = evaluateExperiencePreferences(exp, intent);

      expect(result.positiveMatches).toEqual(
        expect.arrayContaining([
          'history',
          'guided',
          'visit',
          'low budget',
          'accessible',
        ]),
      );
      expect(result.positiveMatches).toHaveLength(5);
      expect(result.score).toBeCloseTo(5 / 8, 5);
    });
  });

  describe('explainability via facetMatches', () => {
    it('populates facetMatches exclusively with genuine PreferenceFacet entries and preserves all 7 fields', () => {
      const exp = {
        canonicalName: 'Recorrido en bici por bodegas boutique',
        themes: ['wine'],
        traits: ['boutique'],
        intents: ['walk'],
      };

      const intent: NormalizedPreferenceIntent = {
        ...emptyIntent,
        preferredFacets: [
          {
            dimension: 'theme',
            key: 'wine',
            importance: 1.0,
            confidence: 0.9,
            source: 'free_text',
          },
          {
            dimension: 'winery_scale',
            key: 'boutique',
            importance: 0.7,
            confidence: 0.8,
            source: 'free_text',
          },
          {
            dimension: 'theme',
            key: 'history',
            importance: 0.5,
            confidence: 0.6,
            source: 'free_text',
          },
        ],
        dietaryPreferences: ['vegan'], // Legacy constraint
      };

      const result = evaluateExperiencePreferences(exp, intent);

      // facetMatches must NOT contain dietaryPreferences ('vegan')
      expect(result.facetMatches).toHaveLength(3);
      expect(
        result.facetMatches.find((m) => m.key === 'vegan'),
      ).toBeUndefined();

      const wineMatch: PreferenceFacetMatch | undefined =
        result.facetMatches.find((m) => m.key === 'wine');
      expect(wineMatch).toBeDefined();
      expect(wineMatch).toEqual({
        dimension: 'theme',
        key: 'wine',
        importance: 1.0,
        confidence: 0.9,
        effectiveWeight: 0.9,
        source: 'free_text',
        matched: true,
      });

      const historyMatch: PreferenceFacetMatch | undefined =
        result.facetMatches.find((m) => m.key === 'history');
      expect(historyMatch).toBeDefined();
      expect(historyMatch).toEqual({
        dimension: 'theme',
        key: 'history',
        importance: 0.5,
        confidence: 0.6,
        effectiveWeight: 0.3,
        source: 'free_text',
        matched: false,
      });
    });

    it('ranks higher an experience matching a high-effectiveWeight facet over one matching a low-effectiveWeight facet', () => {
      const highWeightExp = {
        canonicalName: 'Tour de Vino',
        themes: ['wine'],
      };

      const lowWeightExp = {
        canonicalName: 'Tour de Arquitectura',
        themes: ['architecture'],
      };

      const intent: NormalizedPreferenceIntent = {
        ...emptyIntent,
        preferredFacets: [
          {
            dimension: 'theme',
            key: 'wine',
            importance: 1.0,
            confidence: 1.0, // effectiveWeight = 1.0
            source: 'wizard',
          },
          {
            dimension: 'theme',
            key: 'architecture',
            importance: 0.5,
            confidence: 0.5, // effectiveWeight = 0.25
            source: 'free_text',
          },
        ],
      };

      const highScore = evaluateExperiencePreferences(
        highWeightExp,
        intent,
      ).score;
      const lowScore = evaluateExperiencePreferences(
        lowWeightExp,
        intent,
      ).score;

      // high: matched 1.0 / total 1.25 = 0.8
      // low: matched 0.25 / total 1.25 = 0.2
      expect(highScore).toBeCloseTo(0.8);
      expect(lowScore).toBeCloseTo(0.2);
      expect(highScore).toBeGreaterThan(lowScore);
    });
  });
});
