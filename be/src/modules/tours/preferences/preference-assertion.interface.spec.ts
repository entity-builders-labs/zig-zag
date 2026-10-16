import {
  dedupeAssertions,
  mapStrengthToImportance,
  PreferenceAssertion,
} from './preference-assertion.interface';

function assertion(
  overrides: Partial<PreferenceAssertion> &
    Pick<PreferenceAssertion, 'provenance' | 'importance' | 'confidence'>,
): PreferenceAssertion {
  return {
    target: { dimension: 'theme', key: 'wine' },
    polarity: 'INCLUDE',
    constraint: 'SOFT',
    evidence: [{ kind: 'USER_TEXT_SPAN', text: 'vino' }],
    ...overrides,
  };
}

describe('preference assertions', () => {
  it('maps every asserted strength to its importance, with no default', () => {
    expect(mapStrengthToImportance('strong')).toBe(1);
    expect(mapStrengthToImportance('medium')).toBe(0.7);
    expect(mapStrengthToImportance('weak')).toBe(0.5);
  });

  describe('dedupeAssertions', () => {
    it('keeps a DIRECT assertion over an INFERRED one of the same target, whatever their weights', () => {
      const direct = assertion({
        provenance: 'DIRECT',
        importance: 0.5,
        confidence: 0.6,
      });
      const inferred = assertion({
        provenance: 'INFERRED',
        importance: 1,
        confidence: 1,
      });
      expect(dedupeAssertions([inferred, direct])).toEqual([direct]);
      expect(dedupeAssertions([direct, inferred])).toEqual([direct]);
    });

    it('keeps the higher importance x confidence between assertions of equal provenance', () => {
      const weaker = assertion({
        provenance: 'INFERRED',
        importance: 0.7,
        confidence: 0.5,
      });
      const stronger = assertion({
        provenance: 'INFERRED',
        importance: 0.5,
        confidence: 0.9,
      });
      expect(dedupeAssertions([weaker, stronger])).toEqual([stronger]);
      expect(dedupeAssertions([stronger, weaker])).toEqual([stronger]);
    });

    it('keeps opposite polarities of one target as separate assertions', () => {
      const include = assertion({
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      const exclude = assertion({
        polarity: 'EXCLUDE',
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      expect(dedupeAssertions([include, exclude])).toEqual([include, exclude]);
    });

    it('skips missing assertions (unvalidated structured values)', () => {
      const kept = assertion({
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      expect(dedupeAssertions([undefined, kept, undefined])).toEqual([kept]);
    });
  });
});
