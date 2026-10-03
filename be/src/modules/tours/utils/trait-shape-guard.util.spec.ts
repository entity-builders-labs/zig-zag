import {
  isValidClassifierTraitShape,
  normalizeClassifierTrait,
  sanitizeClassifierTraits,
} from './trait-shape-guard.util';

describe('trait-shape-guard.util', () => {
  describe('isValidClassifierTraitShape', () => {
    it.each([
      ['rooftop'],
      ['craft beer'],
      ['family friendly'],
      ['wheelchair accessible'],
      ['pet friendly patio'],
    ])('accepts a concise open-ended trait: %p', (value) => {
      expect(isValidClassifierTraitShape(value)).toBe(true);
    });

    it.each([
      [
        'This place has a beautiful rooftop terrace with great views.',
        'sentence with ending punctuation and too many words',
      ],
      ['A cozy little café down the street', 'too many words, no punctuation'],
      ['Is it family friendly?', 'ends in a question mark'],
      ['Amazing!', 'ends in an exclamation mark'],
    ])('rejects a generic sentence-shaped value: %p (%s)', (value) => {
      expect(isValidClassifierTraitShape(value)).toBe(false);
    });

    it('rejects empty or whitespace-only strings', () => {
      expect(isValidClassifierTraitShape('')).toBe(false);
      expect(isValidClassifierTraitShape('   ')).toBe(false);
    });

    it('rejects a multi-line string', () => {
      expect(isValidClassifierTraitShape('rooftop\nterrace')).toBe(false);
    });

    it.each([
      [{ dimension: 'theme', key: 'history' }],
      [null],
      [undefined],
      [42],
      [true],
      [['rooftop']],
    ])('rejects a non-string value outright, never coerces it: %p', (value) => {
      expect(isValidClassifierTraitShape(value)).toBe(false);
    });
  });

  describe('normalizeClassifierTrait', () => {
    it('trims, collapses internal whitespace and lowercases', () => {
      expect(normalizeClassifierTrait('  Craft   Beer  ')).toBe('craft beer');
    });
  });

  describe('sanitizeClassifierTraits', () => {
    it('drops invalid entries and normalizes valid ones', () => {
      const result = sanitizeClassifierTraits([
        '  Rooftop ',
        'This is a full sentence trait.',
        { dimension: 'theme', key: 'history' },
        'Family Friendly',
        null,
        42,
      ]);

      expect(result).toEqual(['rooftop', 'family friendly']);
    });

    it('deduplicates by normalized value', () => {
      const result = sanitizeClassifierTraits([
        'Rooftop',
        'rooftop',
        '  ROOFTOP  ',
      ]);
      expect(result).toEqual(['rooftop']);
    });

    it('never throws on a non-array runtime payload and returns []', () => {
      expect(() => sanitizeClassifierTraits('bad' as any)).not.toThrow();
      expect(sanitizeClassifierTraits('bad' as any)).toEqual([]);
      expect(sanitizeClassifierTraits({} as any)).toEqual([]);
      expect(sanitizeClassifierTraits(null as any)).toEqual([]);
      expect(sanitizeClassifierTraits(undefined as any)).toEqual([]);
    });
  });
});
