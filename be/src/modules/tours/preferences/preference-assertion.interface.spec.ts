import {
  dedupeAssertions,
  mapStrengthToImportance,
  PreferenceAssertion,
  resolveAssertions,
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

  describe('resolveAssertions (owner rule 2026-10-16)', () => {
    const permutations = <T>(items: T[]): T[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, index) =>
            permutations([
              ...items.slice(0, index),
              ...items.slice(index + 1),
            ]).map((rest) => [item, ...rest]),
          );
    /** The effective winner must not depend on input order. */
    const expectWinner = (
      items: PreferenceAssertion[],
      winner: PreferenceAssertion,
    ) => {
      for (const order of permutations(items)) {
        expect(resolveAssertions(order).effective).toEqual([winner]);
      }
    };

    it('lets a HARD assertion outrank a SOFT one whatever provenance or weight, in both input orders', () => {
      const softDirect = assertion({
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      const hardInferred = assertion({
        constraint: 'HARD',
        provenance: 'INFERRED',
        importance: 0.5,
        confidence: 0.3,
      });
      expectWinner([softDirect, hardInferred], hardInferred);
      expect(resolveAssertions([softDirect, hardInferred]).superseded).toEqual([
        { assertion: softDirect, reason: 'HARD_OUTRANKS_SOFT' },
      ]);
    });

    it('keeps HARD DIRECT over SOFT DIRECT', () => {
      const hardDirect = assertion({
        constraint: 'HARD',
        provenance: 'DIRECT',
        importance: 0.5,
        confidence: 0.5,
      });
      const softDirect = assertion({
        provenance: 'DIRECT',
        importance: 1,
        confidence: 1,
      });
      expectWinner([softDirect, hardDirect], hardDirect);
    });

    it('compares two DIRECT assertions by stated importance only: confidence never discounts DIRECT', () => {
      const strongUnsure = assertion({
        provenance: 'DIRECT',
        importance: 1,
        confidence: 0.5,
      });
      const weakerSure = assertion({
        provenance: 'DIRECT',
        importance: 0.8,
        confidence: 1,
      });
      expectWinner([weakerSure, strongUnsure], strongUnsure);
      expect(resolveAssertions([weakerSure, strongUnsure]).superseded).toEqual([
        { assertion: weakerSure, reason: 'HIGHER_STATED_IMPORTANCE' },
      ]);
    });

    it('compares two INFERRED assertions by importance x confidence (0.35 vs 0.45)', () => {
      const a = assertion({
        provenance: 'INFERRED',
        importance: 0.7,
        confidence: 0.5,
      });
      const b = assertion({
        provenance: 'INFERRED',
        importance: 0.5,
        confidence: 0.9,
      });
      expectWinner([a, b], b);
      expect(resolveAssertions([a, b]).superseded).toEqual([
        { assertion: a, reason: 'HIGHER_IMPORTANCE_TIMES_CONFIDENCE' },
      ]);
    });

    it('keeps DIRECT over INFERRED of the same constraint, whatever their weights', () => {
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
      expectWinner([inferred, direct], direct);
      expect(resolveAssertions([inferred, direct]).superseded).toEqual([
        { assertion: inferred, reason: 'DIRECT_OUTRANKS_INFERRED' },
      ]);
    });

    it('breaks an exact tie deterministically, without semantic weighting', () => {
      const first = assertion({
        provenance: 'DIRECT',
        importance: 1,
        confidence: 0.9,
        evidence: [{ kind: 'USER_TEXT_SPAN', text: 'a' }],
      });
      const second = assertion({
        provenance: 'DIRECT',
        importance: 1,
        confidence: 0.9,
        evidence: [{ kind: 'USER_TEXT_SPAN', text: 'b' }],
      });
      const winners = permutations([first, second]).map(
        (order) => resolveAssertions(order).effective[0],
      );
      expect(new Set(winners).size).toBe(1);
      expect(resolveAssertions([first, second]).superseded[0].reason).toBe(
        'DETERMINISTIC_TIE_BREAK',
      );
    });

    it('is input-order independent across a mixed group', () => {
      const group = [
        assertion({ provenance: 'INFERRED', importance: 1, confidence: 1 }),
        assertion({ provenance: 'DIRECT', importance: 0.7, confidence: 0.2 }),
        assertion({
          constraint: 'HARD',
          provenance: 'INFERRED',
          importance: 0.5,
          confidence: 0.5,
        }),
        assertion({ provenance: 'DIRECT', importance: 1, confidence: 0.1 }),
      ];
      expectWinner(group, group[2]);
      expect(resolveAssertions(group).superseded).toHaveLength(3);
    });

    it('keeps opposite polarities of one target as separate groups', () => {
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
      expect(resolveAssertions([include, exclude]).effective).toEqual([
        include,
        exclude,
      ]);
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
