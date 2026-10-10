import {
  canonicalizeFacetKey,
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from './preference-facet-vocabulary';

describe('preference-facet-vocabulary', () => {
  describe('canonicalizeFacetKey - dimension scoped synonyms', () => {
    it('canonicalizes autentico for local_character to authentic, but rejects it for tourism_intensity', () => {
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.LOCAL_CHARACTER,
          'autentico',
        ),
      ).toBe('authentic');
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.LOCAL_CHARACTER,
          'auténtico',
        ),
      ).toBe('authentic');

      // In tourism_intensity, autentico is not a valid key or synonym
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.TOURISM_INTENSITY,
          'autentico',
        ),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.TOURISM_INTENSITY,
          'auténtico',
        ),
      ).toBeUndefined();
    });

    it('canonicalizes vino for theme to wine, but rejects it for winery_scale', () => {
      expect(canonicalizeFacetKey(PREFERENCE_DIMENSIONS.THEME, 'vino')).toBe(
        'wine',
      );
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.WINERY_SCALE, 'vino'),
      ).toBeUndefined();
    });

    it('canonicalizes winery scale synonyms correctly', () => {
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.WINERY_SCALE, 'chica'),
      ).toBe('boutique');
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.WINERY_SCALE, 'pequeña'),
      ).toBe('boutique');
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.WINERY_SCALE, 'mediana'),
      ).toBe('medium');
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.WINERY_SCALE, 'grande'),
      ).toBe('industrial');
    });

    it('canonicalizes nature type and tourism intensity synonyms', () => {
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.NATURE_TYPE, 'montaña'),
      ).toBe('mountain');
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.TOURISM_INTENSITY,
          'secreto',
        ),
      ).toBe('hidden');
    });
  });

  describe('canonicalizeFacetKey - controlled vocabulary rejection', () => {
    it('returns undefined for unknown keys in controlled dimensions', () => {
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.THEME, 'unsupported_theme'),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, 'crazy_intent'),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.WINERY_SCALE,
          'hyper_massive',
        ),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.TOURISM_INTENSITY,
          'extreme_tourist',
        ),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.NATURE_TYPE, 'volcano'),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.LOCAL_CHARACTER,
          'futuristic',
        ),
      ).toBeUndefined();
    });

    it('accepts open-ended non-empty strings for trait dimension', () => {
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.TRAIT, 'open_trait_123'),
      ).toBe('open_trait_123');
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.TRAIT, 'handcrafted goods'),
      ).toBe('handcrafted_goods');
    });

    it('canonicalizes the two actionable exploration_style poles and rejects everything else', () => {
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.EXPLORATION_STYLE, 'iconic'),
      ).toBe('iconic');
      expect(canonicalizeFacetKey('exploration_style', 'local_deep_dive')).toBe(
        'local_deep_dive',
      );
      // BALANCED is neutral -> no facet; the old Phase-2 speculative keys are gone.
      expect(
        canonicalizeFacetKey('exploration_style', 'balanced'),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey(
          PREFERENCE_DIMENSIONS.EXPLORATION_STYLE,
          'relaxed',
        ),
      ).toBeUndefined();
      expect(
        canonicalizeFacetKey('completely_unknown_dimension', 'some_key'),
      ).toBeUndefined();
    });

    it('returns undefined for empty/invalid inputs', () => {
      expect(canonicalizeFacetKey('', 'key')).toBeUndefined();
      expect(canonicalizeFacetKey('theme', '')).toBeUndefined();
      expect(
        canonicalizeFacetKey(null as any, undefined as any),
      ).toBeUndefined();
    });
  });

  describe('real repository vocabulary presence', () => {
    it('contains real intents food and nightlife', () => {
      expect(
        INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.INTENT],
      ).toContain('food');
      expect(
        INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.INTENT],
      ).toContain('nightlife');
      expect(canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, 'food')).toBe(
        'food',
      );
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, 'nightlife'),
      ).toBe('nightlife');
      expect(canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, 'comida')).toBe(
        'food',
      );
    });

    it('contains real themes shopping and sports', () => {
      expect(
        INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME],
      ).toContain('shopping');
      expect(
        INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME],
      ).toContain('sports');
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.THEME, 'shopping'),
      ).toBe('shopping');
      expect(canonicalizeFacetKey(PREFERENCE_DIMENSIONS.THEME, 'compras')).toBe(
        'shopping',
      );
    });
  });
});
