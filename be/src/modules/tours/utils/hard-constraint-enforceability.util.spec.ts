import {
  AmbiguousHardConstraintError,
  findAmbiguousHardConstraints,
  findUnenforceableHardConstraints,
  HardConstraintUnenforceableError,
} from './hard-constraint-enforceability.util';
import {
  PreferenceAssertion,
  UnresolvedPreferenceConcept,
} from '../preferences/preference-assertion.interface';

function assertion(
  overrides: Pick<PreferenceAssertion, 'target' | 'polarity' | 'constraint'>,
): PreferenceAssertion {
  return {
    provenance: 'DIRECT',
    importance: 1,
    confidence: 1,
    evidence: [{ kind: 'USER_TEXT_SPAN', text: 'fixture' }],
    ...overrides,
  };
}

function unresolved(
  overrides: Pick<UnresolvedPreferenceConcept, 'polarity' | 'constraint'>,
): UnresolvedPreferenceConcept {
  return {
    label: 'religious sites',
    evidence: [{ kind: 'USER_TEXT_SPAN', text: 'iglesias' }],
    reason: 'UNRESOLVED_OPEN_CONCEPT',
    ...overrides,
  };
}

describe('findUnenforceableHardConstraints', () => {
  it('reports nothing when the request has only SOFT assertions and SOFT open concepts', () => {
    expect(
      findUnenforceableHardConstraints({
        assertions: [
          assertion({
            target: { dimension: 'theme', key: 'history' },
            polarity: 'INCLUDE',
            constraint: 'SOFT',
          }),
          assertion({
            target: { dimension: 'theme', key: 'nightlife' },
            polarity: 'EXCLUDE',
            constraint: 'SOFT',
          }),
        ],
        unresolvedConcepts: [
          unresolved({ polarity: 'INCLUDE', constraint: 'SOFT' }),
          unresolved({ polarity: 'EXCLUDE', constraint: 'SOFT' }),
        ],
      }),
    ).toEqual([]);
  });

  it('treats a HARD typed assertion as unenforceable: absence of a fact never proves compatibility', () => {
    expect(
      findUnenforceableHardConstraints({
        assertions: [
          assertion({
            target: { dimension: 'dietary_suitability', key: 'vegan' },
            polarity: 'INCLUDE',
            constraint: 'HARD',
          }),
          assertion({
            target: { dimension: 'theme', key: 'nightlife' },
            polarity: 'EXCLUDE',
            constraint: 'HARD',
          }),
        ],
        unresolvedConcepts: [],
      }),
    ).toEqual([
      {
        target: { dimension: 'dietary_suitability', key: 'vegan' },
        unresolvedLabel: null,
        polarity: 'INCLUDE',
        missingKnowledge: 'CLASSIFICATION_COMPLETENESS',
        reason: 'COMPATIBILITY_CANNOT_BE_PROVEN',
      },
      {
        target: { dimension: 'theme', key: 'nightlife' },
        unresolvedLabel: null,
        polarity: 'EXCLUDE',
        missingKnowledge: 'CLASSIFICATION_COMPLETENESS',
        reason: 'COMPATIBILITY_CANNOT_BE_PROVEN',
      },
    ]);
  });

  it('treats a HARD open concept as unenforceable for lack of a shared typed identity', () => {
    expect(
      findUnenforceableHardConstraints({
        assertions: [],
        unresolvedConcepts: [
          unresolved({ polarity: 'EXCLUDE', constraint: 'HARD' }),
        ],
      }),
    ).toEqual([
      {
        target: null,
        unresolvedLabel: 'religious sites',
        polarity: 'EXCLUDE',
        missingKnowledge: 'SHARED_CONCEPT_IDENTITY',
        reason: 'COMPATIBILITY_CANNOT_BE_PROVEN',
      },
    ]);
  });
});

describe('HardConstraintUnenforceableError', () => {
  it('carries the typed outcome, distinct from an infeasible Tour', () => {
    const constraints = findUnenforceableHardConstraints({
      assertions: [],
      unresolvedConcepts: [
        unresolved({ polarity: 'EXCLUDE', constraint: 'HARD' }),
      ],
    });
    const error = new HardConstraintUnenforceableError(
      constraints,
      'Buenos Aires',
    );
    expect(error.outcome).toBe('HARD_CONSTRAINT_UNENFORCEABLE');
    expect(error.constraints).toBe(constraints);
    expect(error.destination).toBe('Buenos Aires');
    // The trace message names the missing knowledge, never the user's text.
    expect(error.message).toContain('SHARED_CONCEPT_IDENTITY');
    expect(error.message).not.toContain('religious');
  });
});

describe('ambiguous hard constraints', () => {
  const include = assertion({
    target: { dimension: 'theme', key: 'nightlife' },
    polarity: 'INCLUDE',
    constraint: 'SOFT',
  });
  const hardExclude = assertion({
    target: { dimension: 'theme', key: 'nightlife' },
    polarity: 'EXCLUDE',
    constraint: 'HARD',
  });

  it('selects only blocking polarity conflicts', () => {
    const blocking = {
      target: include.target,
      include,
      exclude: hardExclude,
      blocking: true,
      reason: 'PREFERENCE_POLARITY_CONFLICT' as const,
    };
    const soft = { ...blocking, blocking: false };
    expect(
      findAmbiguousHardConstraints({ polarityConflicts: [soft, blocking] }),
    ).toEqual([blocking]);
  });

  it('carries the AMBIGUOUS_HARD_CONSTRAINT outcome, not HARD_CONSTRAINT_UNENFORCEABLE', () => {
    const error = new AmbiguousHardConstraintError(
      [
        {
          target: include.target,
          include,
          exclude: hardExclude,
          blocking: true,
          reason: 'PREFERENCE_POLARITY_CONFLICT',
        },
      ],
      'Buenos Aires',
    );
    expect(error.outcome).toBe('AMBIGUOUS_HARD_CONSTRAINT');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('theme:nightlife');
    expect(error.message).not.toContain('HARD_CONSTRAINT_UNENFORCEABLE');
  });
});
