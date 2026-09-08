import {
  calculateEffectiveWeight,
  mapStrengthToImportance,
  PreferenceFacet,
} from '../preferences/preference-facet.interface';
import {
  mergePreferenceFacets,
  normalizeWizardFacet,
} from './preference-facet-merge.util';

describe('preference-facet-merge.util', () => {
  describe('normalizeWizardFacet', () => {
    it('creates a facet with importance 1, confidence 1, and source wizard', () => {
      const facet = normalizeWizardFacet('theme', 'history');
      expect(facet).toEqual({
        dimension: 'theme',
        key: 'history',
        importance: 1.0,
        confidence: 1.0,
        source: 'wizard',
      });
    });

    it('maps localized Spanish wording to canonical domain keys', () => {
      const facet = normalizeWizardFacet('theme', 'arquitectura');
      expect(facet).toEqual({
        dimension: 'theme',
        key: 'architecture',
        importance: 1.0,
        confidence: 1.0,
        source: 'wizard',
      });
    });

    it('maps intent synonyms to canonical domain keys', () => {
      const facet = normalizeWizardFacet('intent', 'caminata');
      expect(facet).toEqual({
        dimension: 'intent',
        key: 'walk',
        importance: 1.0,
        confidence: 1.0,
        source: 'wizard',
      });
    });
  });

  describe('mergePreferenceFacets', () => {
    it('gives absolute precedence to wizard facets over free-text facets with the same dimension and key', () => {
      const wizardFacets: PreferenceFacet[] = [
        {
          dimension: 'theme',
          key: 'wine',
          importance: 1.0,
          confidence: 1.0,
          source: 'wizard',
        },
      ];
      const freeTextFacets: PreferenceFacet[] = [
        {
          dimension: 'theme',
          key: 'wine',
          importance: 0.7,
          confidence: 0.5,
          source: 'free_text',
        },
      ];

      const merged = mergePreferenceFacets(wizardFacets, freeTextFacets);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual({
        dimension: 'theme',
        key: 'wine',
        importance: 1.0,
        confidence: 1.0,
        source: 'wizard',
      });
    });

    it('does not weaken a wizard facet when free-text uses a localized synonym for the same concept', () => {
      const wizardFacets: PreferenceFacet[] = [
        normalizeWizardFacet('theme', 'architecture'),
      ];
      // Free text interpreted "arquitectura"
      const freeTextFacets: PreferenceFacet[] = [
        {
          dimension: 'theme',
          key: 'arquitectura',
          importance: 0.5,
          confidence: 0.6,
          source: 'free_text',
        },
      ];

      const merged = mergePreferenceFacets(wizardFacets, freeTextFacets);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual({
        dimension: 'theme',
        key: 'architecture',
        importance: 1.0,
        confidence: 1.0,
        source: 'wizard',
      });
    });

    it('retains disjoint free-text facets alongside wizard facets', () => {
      const wizardFacets: PreferenceFacet[] = [
        normalizeWizardFacet('theme', 'history'),
      ];
      const freeTextFacets: PreferenceFacet[] = [
        {
          dimension: 'winery_scale',
          key: 'boutique',
          importance: 0.7,
          confidence: 0.8,
          source: 'free_text',
        },
        {
          dimension: 'tourism_intensity',
          key: 'hidden',
          importance: 1.0,
          confidence: 0.9,
          source: 'free_text',
        },
      ];

      const merged = mergePreferenceFacets(wizardFacets, freeTextFacets);

      expect(merged).toHaveLength(3);
      expect(merged).toEqual(
        expect.arrayContaining([
          {
            dimension: 'theme',
            key: 'history',
            importance: 1.0,
            confidence: 1.0,
            source: 'wizard',
          },
          {
            dimension: 'winery_scale',
            key: 'boutique',
            importance: 0.7,
            confidence: 0.8,
            source: 'free_text',
          },
          {
            dimension: 'tourism_intensity',
            key: 'hidden',
            importance: 1.0,
            confidence: 0.9,
            source: 'free_text',
          },
        ]),
      );
    });

    it('distinguishes identical keys if they belong to different dimensions', () => {
      const wizardFacets: PreferenceFacet[] = [
        normalizeWizardFacet('theme', 'park'),
      ];
      const freeTextFacets: PreferenceFacet[] = [
        {
          dimension: 'nature_type',
          key: 'park',
          importance: 0.7,
          confidence: 0.9,
          source: 'free_text',
        },
      ];

      const merged = mergePreferenceFacets(wizardFacets, freeTextFacets);

      expect(merged).toHaveLength(2);
      expect(merged.find((f) => f.dimension === 'theme')?.key).toBe('park');
      expect(merged.find((f) => f.dimension === 'nature_type')?.key).toBe(
        'park',
      );
    });
  });

  describe('deterministic helpers', () => {
    it('maps strength to deterministic importance', () => {
      expect(mapStrengthToImportance('strong')).toBe(1.0);
      expect(mapStrengthToImportance('medium')).toBe(0.7);
      expect(mapStrengthToImportance('weak')).toBe(0.5);
      expect(mapStrengthToImportance(undefined)).toBe(0.7);
    });

    it('calculates effectiveWeight as importance * confidence', () => {
      expect(
        calculateEffectiveWeight({
          dimension: 'theme',
          key: 'wine',
          importance: 1.0,
          confidence: 0.8,
          source: 'free_text',
        }),
      ).toBeCloseTo(0.8);

      expect(
        calculateEffectiveWeight({
          dimension: 'theme',
          key: 'wine',
          importance: 0.7,
          confidence: 0.5,
          source: 'free_text',
        }),
      ).toBeCloseTo(0.35);
    });
  });
});
