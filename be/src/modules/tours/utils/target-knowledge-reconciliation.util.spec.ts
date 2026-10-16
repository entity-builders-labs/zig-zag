import { reconcileTargetKnowledge } from './target-knowledge-reconciliation.util';
import { TargetObservation } from '../preferences/target-knowledge.interface';

function observation(
  state: TargetObservation['state'],
  sourceFactId = `fact-${state}`,
): TargetObservation {
  return { sourceFactId, state };
}

describe('reconcileTargetKnowledge', () => {
  it('returns UNKNOWN { NO_EVIDENCE } for no observations', () => {
    expect(reconcileTargetKnowledge([])).toEqual({
      state: 'UNKNOWN',
      reason: 'NO_EVIDENCE',
    });
  });

  it('returns SATISFIES when every observation SATISFIES', () => {
    expect(
      reconcileTargetKnowledge([
        observation('SATISFIES'),
        observation('SATISFIES'),
      ]),
    ).toEqual({ state: 'SATISFIES' });
  });

  it('returns DOES_NOT_SATISFY when every observation DOES_NOT_SATISFY', () => {
    expect(reconcileTargetKnowledge([observation('DOES_NOT_SATISFY')])).toEqual(
      {
        state: 'DOES_NOT_SATISFY',
      },
    );
  });

  it('returns UNKNOWN { CONFLICTING_EVIDENCE } when SATISFIES and DOES_NOT_SATISFY disagree', () => {
    expect(
      reconcileTargetKnowledge([
        observation('SATISFIES'),
        observation('DOES_NOT_SATISFY'),
      ]),
    ).toEqual({ state: 'UNKNOWN', reason: 'CONFLICTING_EVIDENCE' });
  });

  it('returns UNKNOWN { INCONCLUSIVE_EVIDENCE } when any observation is inconclusive', () => {
    expect(
      reconcileTargetKnowledge([
        observation('SATISFIES'),
        observation('INCONCLUSIVE'),
      ]),
    ).toEqual({ state: 'UNKNOWN', reason: 'INCONCLUSIVE_EVIDENCE' });
  });

  it('applies no provider/source precedence between independent sources', () => {
    expect(
      reconcileTargetKnowledge([
        observation('SATISFIES', 'source-a'),
        observation('DOES_NOT_SATISFY', 'source-b'),
      ]),
    ).toEqual({ state: 'UNKNOWN', reason: 'CONFLICTING_EVIDENCE' });
  });
});
