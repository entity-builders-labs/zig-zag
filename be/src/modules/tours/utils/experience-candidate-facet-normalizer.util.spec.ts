import {
  INITIAL_DIMENSION_VOCABULARY,
  PREFERENCE_DIMENSIONS,
} from '../preferences/preference-facet-vocabulary';
import {
  CANONICAL_INTENT_KEYS,
  CANONICAL_THEME_KEYS,
  normalizeExperienceCandidateFacets,
} from './experience-candidate-facet-normalizer.util';

const norm = (
  themes: unknown[],
  traits: unknown[],
  intents: unknown[],
): { themes: string[]; traits: string[]; intents: string[] } =>
  normalizeExperienceCandidateFacets({ themes, traits, intents });

describe('normalizeExperienceCandidateFacets', () => {
  it('A. keeps already-canonical themes and an open trait untouched', () => {
    expect(norm(['history', 'architecture'], ['Rooftop'], [])).toEqual({
      themes: ['history', 'architecture'],
      traits: ['Rooftop'],
      intents: [],
    });
  });

  it('B. canonicalizes localized theme synonyms', () => {
    expect(norm(['historia', 'arquitectura', 'VINO'], [], [])).toEqual({
      themes: ['history', 'architecture', 'wine'],
      traits: [],
      intents: [],
    });
  });

  it('C. promotes canonical themes leaked into traits, keeps the real trait', () => {
    expect(
      norm([], ['history', 'cultura', 'Architecture', 'Craft Beer'], []),
    ).toEqual({
      themes: ['history', 'culture', 'architecture'],
      traits: ['Craft Beer'],
      intents: [],
    });
  });

  it('D. a controlled key present in both themes and traits never stays a trait', () => {
    expect(norm(['history'], ['History', 'historia'], [])).toEqual({
      themes: ['history'],
      traits: [],
      intents: [],
    });
  });

  it('E. an unknown theme falls back to an open trait (no vocabulary growth)', () => {
    expect(norm(['craft beer'], [], [])).toEqual({
      themes: [],
      traits: ['craft beer'],
      intents: [],
    });
  });

  it('F. canonicalizes localized intent synonyms', () => {
    expect(norm([], [], ['walking', 'excursión', 'visita'])).toEqual({
      themes: [],
      traits: [],
      intents: ['walk', 'day_trip', 'visit'],
    });
  });

  it('G. an unknown intent falls back to an open trait, never a fake intent', () => {
    expect(norm([], [], ['guided'])).toEqual({
      themes: [],
      traits: ['guided'],
      intents: [],
    });
  });

  it('H. a canonical theme emitted inside intents is repaired to a theme (never a trait)', () => {
    expect(norm([], [], ['history'])).toEqual({
      themes: ['history'],
      traits: [],
      intents: [],
    });
  });

  it('I. a canonical intent emitted inside themes is repaired to an intent', () => {
    expect(norm(['walk'], [], [])).toEqual({
      themes: [],
      traits: [],
      intents: ['walk'],
    });
  });

  it('J. a canonical intent leaked into traits is promoted, the real trait stays', () => {
    expect(norm([], ['walk', 'Craft Beer'], [])).toEqual({
      themes: [],
      traits: ['Craft Beer'],
      intents: ['walk'],
    });
  });

  it('K. dedupes open traits case-insensitively, keeping the first trimmed label', () => {
    expect(norm([], ['Craft Beer', 'craft beer', ' CRAFT BEER '], [])).toEqual({
      themes: [],
      traits: ['Craft Beer'],
      intents: [],
    });
  });

  describe('L. an ambiguous controlled key (valid in THEME and INTENT) respects its origin array', () => {
    it('from themes[] -> theme', () => {
      expect(norm(['food'], [], [])).toEqual({
        themes: ['food'],
        traits: [],
        intents: [],
      });
    });

    it('from intents[] -> intent', () => {
      expect(norm([], [], ['food'])).toEqual({
        themes: [],
        traits: [],
        intents: ['food'],
      });
    });

    it('from traits[] -> theme (trait precedence is THEME before INTENT)', () => {
      expect(norm([], ['food'], [])).toEqual({
        themes: ['food'],
        traits: [],
        intents: [],
      });
    });

    it('nightlife behaves the same way', () => {
      expect(norm(['nightlife'], [], [])).toEqual({
        themes: ['nightlife'],
        traits: [],
        intents: [],
      });
      expect(norm([], [], ['nightlife'])).toEqual({
        themes: [],
        traits: [],
        intents: ['nightlife'],
      });
      expect(norm([], ['nightlife'], [])).toEqual({
        themes: ['nightlife'],
        traits: [],
        intents: [],
      });
    });
  });

  it('M. the same key explicitly supplied in both controlled arrays survives in both (no global theme<->intent dedupe)', () => {
    expect(norm(['food'], [], ['food'])).toEqual({
      themes: ['food'],
      traits: [],
      intents: ['food'],
    });
  });

  it('long-tail acceptance: food + [craft beer, small local breweries, history] + route_like', () => {
    expect(
      norm(
        ['food'],
        ['craft beer', 'small local breweries', 'history'],
        ['route_like'],
      ),
    ).toEqual({
      themes: ['food', 'history'],
      traits: ['craft beer', 'small local breweries'],
      intents: ['route_like'],
    });
  });

  it('ignores non-string and empty values without discarding real ones', () => {
    expect(
      norm(['', '   ', 123 as unknown, null as unknown, 'history'], [], []),
    ).toEqual({ themes: ['history'], traits: [], intents: [] });
  });

  it('is deterministic for identical input', () => {
    const input = {
      themes: ['food', 'historia'],
      traits: ['Craft Beer', 'history', 'walk'],
      intents: ['walking', 'guided'],
    };
    expect(normalizeExperienceCandidateFacets(input)).toEqual(
      normalizeExperienceCandidateFacets(input),
    );
  });

  it('exposes the canonical vocabularies straight from the central source of truth', () => {
    expect(CANONICAL_THEME_KEYS).toEqual(
      INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME],
    );
    expect(CANONICAL_INTENT_KEYS).toEqual(
      INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.INTENT],
    );
  });

  it('does NOT grow the theme vocabulary to absorb long-tail concepts', () => {
    for (const longTail of [
      'beer',
      'brewery',
      'craft_beer',
      'street_art',
      'specialty_coffee',
    ]) {
      expect(
        INITIAL_DIMENSION_VOCABULARY[PREFERENCE_DIMENSIONS.THEME],
      ).not.toContain(longTail);
    }
  });
});
