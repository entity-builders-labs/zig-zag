import {
  classifyHardTarget,
  resolveHardTargetEligibility,
} from './hard-eligibility.policy';
import { SemanticTarget } from '../preferences/preference-assertion.interface';
import { TargetKnowledge } from '../preferences/target-knowledge.interface';

const SATISFIES: TargetKnowledge = { state: 'SATISFIES' };
const DOES_NOT: TargetKnowledge = { state: 'DOES_NOT_SATISFY' };
const CONFLICTING: TargetKnowledge = {
  state: 'UNKNOWN',
  reason: 'CONFLICTING_EVIDENCE',
};

function target(dimension: string, key: string): SemanticTarget {
  return { dimension: dimension as SemanticTarget['dimension'], key };
}

/** One candidate: its required-component reconciled knowledge. */
function candidate(
  knowledge: readonly TargetKnowledge[],
): readonly TargetKnowledge[] {
  return knowledge;
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
        candidate([SATISFIES]),
        candidate([SATISFIES]),
      ]),
    ).toEqual({ kind: 'ELIGIBLE', compatibleIndexes: [0, 1] });
  });

  it('admits only the compatible candidates of a HARD INCLUDE target', () => {
    expect(
      resolveHardTargetEligibility('INCLUDE', [
        candidate([SATISFIES]),
        candidate([DOES_NOT]),
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
      resolveHardTargetEligibility('INCLUDE', [candidate([CONFLICTING])]),
    ).toEqual({
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'TARGET_KNOWLEDGE_UNKNOWN',
      unknownReason: 'CONFLICTING_EVIDENCE',
    });
  });

  it('is INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY when some candidates are incompatible and none compatible', () => {
    expect(
      resolveHardTargetEligibility('INCLUDE', [
        candidate([DOES_NOT]),
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
        candidate([DOES_NOT]),
        candidate([SATISFIES]),
      ]),
    ).toEqual({ kind: 'ELIGIBLE', compatibleIndexes: [0] });
  });

  it('rejects a HARD EXCLUDE target when any required component SATISFIES', () => {
    expect(
      resolveHardTargetEligibility('EXCLUDE', [candidate([SATISFIES])]),
    ).toEqual({
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY',
    });
  });
});
