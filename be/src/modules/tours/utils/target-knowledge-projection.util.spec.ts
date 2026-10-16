import {
  applyObservation,
  candidateTargetCompatibility,
} from './target-knowledge-projection.util';
import { TargetObservation } from '../preferences/target-knowledge.interface';

function observation(
  state: TargetObservation['state'],
  id: string,
): TargetObservation {
  return { sourceFactId: id, state };
}

describe('applyObservation', () => {
  it('replaces only the prior observation of the same source-fact identity', () => {
    const existing = [
      observation('SATISFIES', 'a'),
      observation('DOES_NOT_SATISFY', 'b'),
    ];
    expect(
      applyObservation(existing, observation('INCONCLUSIVE', 'a')),
    ).toEqual([
      observation('DOES_NOT_SATISFY', 'b'),
      observation('INCONCLUSIVE', 'a'),
    ]);
  });

  it('appends a new source fact without touching independent sources', () => {
    expect(
      applyObservation(
        [observation('SATISFIES', 'a')],
        observation('DOES_NOT_SATISFY', 'b'),
      ),
    ).toEqual([
      observation('SATISFIES', 'a'),
      observation('DOES_NOT_SATISFY', 'b'),
    ]);
  });
});

describe('candidateTargetCompatibility', () => {
  it('aggregates a single-place candidate (one component)', () => {
    expect(
      candidateTargetCompatibility('INCLUDE', [
        [observation('SATISFIES', 'a')],
      ]),
    ).toBe('COMPATIBLE');
    expect(
      candidateTargetCompatibility('INCLUDE', [
        [observation('DOES_NOT_SATISFY', 'a')],
      ]),
    ).toBe('INCOMPATIBLE');
    expect(candidateTargetCompatibility('INCLUDE', [[]])).toBe('UNKNOWN');
  });

  it('aggregates a composite candidate across required components', () => {
    // INCLUDE: one SATISFIES, one DOES_NOT_SATISFY -> INCOMPATIBLE.
    expect(
      candidateTargetCompatibility('INCLUDE', [
        [observation('SATISFIES', 'a')],
        [observation('DOES_NOT_SATISFY', 'b')],
      ]),
    ).toBe('INCOMPATIBLE');
    // EXCLUDE: all DOES_NOT_SATISFY -> COMPATIBLE.
    expect(
      candidateTargetCompatibility('EXCLUDE', [
        [observation('DOES_NOT_SATISFY', 'a')],
        [observation('DOES_NOT_SATISFY', 'b')],
      ]),
    ).toBe('COMPATIBLE');
  });
});
