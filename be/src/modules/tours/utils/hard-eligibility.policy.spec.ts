import {
  classifyHardTarget,
  resolveHardTargetEligibility,
} from './hard-eligibility.policy';
import { SemanticTarget } from '../preferences/preference-assertion.interface';
import { TargetObservation } from '../preferences/target-knowledge.interface';

function target(dimension: string, key: string): SemanticTarget {
  return { dimension: dimension as SemanticTarget['dimension'], key };
}

function observation(
  state: TargetObservation['state'],
  id: string,
): TargetObservation {
  return { sourceFactId: id, state };
}

/** One candidate whose single required component holds these observations. */
function candidate(
  observations: readonly TargetObservation[],
): readonly (readonly TargetObservation[])[] {
  return [observations];
}

describe('classifyHardTarget (split gate)', () => {
  it('classifies accessibility:wheelchair_access as requiring target knowledge', () => {
    expect(
      classifyHardTarget(target('accessibility', 'wheelchair_access')),
    ).toEqual({ kind: 'REQUIRES_TARGET_KNOWLEDGE' });
  });

  it('classifies accessibility:avoid_stairs as unenforceable (no producer)', () => {
    expect(classifyHardTarget(target('accessibility', 'avoid_stairs'))).toEqual(
      {
        kind: 'UNENFORCEABLE',
        missingKnowledge: 'TARGET_PRODUCER_UNAVAILABLE',
      },
    );
  });

  it('classifies dietary_suitability:vegan as unenforceable (not applicable)', () => {
    expect(classifyHardTarget(target('dietary_suitability', 'vegan'))).toEqual({
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'TARGET_APPLICABILITY_UNKNOWN',
    });
  });

  it('classifies theme as unenforceable (SOFT-only)', () => {
    expect(classifyHardTarget(target('theme', 'history'))).toEqual({
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'TARGET_APPLICABILITY_UNKNOWN',
    });
  });
});

describe('resolveHardTargetEligibility (post-catalog)', () => {
  it('admits every candidate that SATISFIES a HARD INCLUDE target', () => {
    expect(
      resolveHardTargetEligibility('INCLUDE', [
        candidate([observation('SATISFIES', 'a')]),
        candidate([observation('SATISFIES', 'b')]),
      ]),
    ).toEqual({ kind: 'ELIGIBLE', compatibleIndexes: [0, 1] });
  });

  it('admits only the compatible candidates of a HARD INCLUDE target', () => {
    expect(
      resolveHardTargetEligibility('INCLUDE', [
        candidate([observation('SATISFIES', 'a')]),
        candidate([observation('DOES_NOT_SATISFY', 'b')]),
        candidate([]),
      ]),
    ).toEqual({ kind: 'ELIGIBLE', compatibleIndexes: [0] });
  });

  it('is TARGET_KNOWLEDGE_UNKNOWN when every candidate is UNKNOWN', () => {
    expect(
      resolveHardTargetEligibility('INCLUDE', [candidate([]), candidate([])]),
    ).toEqual({
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'TARGET_KNOWLEDGE_UNKNOWN',
      unknownReason: 'NO_EVIDENCE',
    });
  });

  it('retains the underlying CONFLICTING_EVIDENCE reason when nothing is compatible', () => {
    expect(
      resolveHardTargetEligibility('INCLUDE', [
        candidate([
          observation('SATISFIES', 'a'),
          observation('DOES_NOT_SATISFY', 'b'),
        ]),
      ]),
    ).toEqual({
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'TARGET_KNOWLEDGE_UNKNOWN',
      unknownReason: 'CONFLICTING_EVIDENCE',
    });
  });

  it('is INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY when some candidates are incompatible and none compatible', () => {
    expect(
      resolveHardTargetEligibility('INCLUDE', [
        candidate([observation('DOES_NOT_SATISFY', 'a')]),
        candidate([]),
      ]),
    ).toEqual({
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY',
    });
  });

  it('admits a HARD EXCLUDE target only when every required component DOES_NOT_SATISFY', () => {
    expect(
      resolveHardTargetEligibility('EXCLUDE', [
        candidate([observation('DOES_NOT_SATISFY', 'a')]),
        candidate([observation('SATISFIES', 'b')]),
      ]),
    ).toEqual({ kind: 'ELIGIBLE', compatibleIndexes: [0] });
  });

  it('rejects a HARD EXCLUDE target when any required component SATISFIES', () => {
    expect(
      resolveHardTargetEligibility('EXCLUDE', [
        candidate([observation('SATISFIES', 'a')]),
      ]),
    ).toEqual({
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY',
    });
  });
});
