import {
  canonicalizeFacetKey,
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from './preference-facet-vocabulary';

describe('preference-facet-vocabulary', () => {
  describe('canonicalizeFacetKey - formatting normalization only, never translation', () => {
    it('normalizes case, accents and separators of a schema key', () => {
      expect(canonicalizeFacetKey(PREFERENCE_DIMENSIONS.THEME, 'History')).toBe(
        'history',
      );
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, 'route-like'),
      ).toBe('route_like');
      expect(
        canonicalizeFacetKey(PREFERENCE_DIMENSIONS.INTENT, 'Day Trip'),
      ).toBe('day_trip');
    });

    it.each([
      [PREFERENCE_DIMENSIONS.LOCAL_CHARACTER, 'autentico'],
      [PREFERENCE_DIMENSIONS.LOCAL_CHARACTER, 'auténtico'],
      [PREFERENCE_DIMENSIONS.THEME, 'vino'],
      [PREFERENCE_DIMENSIONS.THEME, 'compras'],
      [PREFERENCE_DIMENSIONS.WINERY_SCALE, 'chica'],
      [PREFERENCE_DIMENSIONS.WINERY_SCALE, 'pequeña'],
      [PREFERENCE_DIMENSIONS.NATURE_TYPE, 'montaña'],
      [PREFERENCE_DIMENSIONS.TOURISM_INTENSITY, 'secreto'],
      [PREFERENCE_DIMENSIONS.INTENT, 'comida'],
    ])(
      'never translates a natural-language word (%s:%s) into a schema key',
      (dimension, word) => {
        expect(canonicalizeFacetKey(dimension, word)).toBeUndefined();
      },
    );
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

    it('has no exploration_style facet dimension: exploration style is a composition-local tilt', () => {
      expect(
        canonicalizeFacetKey('exploration_style', 'iconic'),
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
    });
  });
});
