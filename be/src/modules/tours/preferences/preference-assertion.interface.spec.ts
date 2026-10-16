import {
  dedupeAssertions,
  mapStrengthToImportance,
  PreferenceAssertion,
  separatePolarityConflicts,
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

  describe('separatePolarityConflicts', () => {
    it('keeps neither polarity of a target asserted as INCLUDE and EXCLUDE, whatever their provenance and weight', () => {
      const include = assertion({
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      const exclude = assertion({
        polarity: 'EXCLUDE',
        provenance: 'INFERRED',
        importance: 0.5,
        confidence: 0.4,
      });
      const other = assertion({
        target: { dimension: 'theme', key: 'history' },
        provenance: 'INFERRED',
        importance: 0.7,
        confidence: 0.9,
      });
      expect(separatePolarityConflicts([include, exclude, other])).toEqual({
        assertions: [other],
        conflicts: [
          {
            target: { dimension: 'theme', key: 'wine' },
            include,
            exclude,
            blocking: false,
            reason: 'PREFERENCE_POLARITY_CONFLICT',
          },
        ],
      });
    });

    it('marks a conflict blocking when either assertion is HARD', () => {
      const include = assertion({
        provenance: 'INFERRED',
        importance: 0.5,
        confidence: 0.5,
      });
      const hardExclude = assertion({
        polarity: 'EXCLUDE',
        constraint: 'HARD',
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      const result = separatePolarityConflicts([include, hardExclude]);
      expect(result.assertions).toEqual([]);
      expect(result.conflicts).toEqual([
        expect.objectContaining({
          blocking: true,
          reason: 'PREFERENCE_POLARITY_CONFLICT',
        }),
      ]);
      const hardInclude = assertion({
        constraint: 'HARD',
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      const softExclude = assertion({
        polarity: 'EXCLUDE',
        provenance: 'INFERRED',
        importance: 0.5,
        confidence: 0.5,
      });
      expect(
        separatePolarityConflicts([hardInclude, softExclude]).conflicts[0]
          .blocking,
      ).toBe(true);
    });

    it('leaves a single polarity per target untouched', () => {
      const exclude = assertion({
        polarity: 'EXCLUDE',
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      expect(separatePolarityConflicts([exclude])).toEqual({
        assertions: [exclude],
        conflicts: [],
      });
    });
  });
});
