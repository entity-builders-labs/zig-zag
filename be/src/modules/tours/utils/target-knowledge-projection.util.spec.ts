import { applyObservation } from './target-knowledge-projection.util';
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
