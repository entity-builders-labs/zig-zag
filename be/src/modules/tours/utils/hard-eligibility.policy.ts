import {
  PreferencePolarity,
  SemanticTarget,
} from '../preferences/preference-assertion.interface';
import {
  TargetCompatibility,
  TargetObservation,
  UnknownTargetReason,
} from '../preferences/target-knowledge.interface';
import {
  HardConstraintMissingKnowledge,
  targetApplicability,
} from './target-applicability.util';
import { candidateTargetCompatibility } from './target-knowledge-projection.util';
import { reconcileTargetKnowledge } from './target-knowledge-reconciliation.util';

/**
 * The split gate (task 25.7, owner 2026-10-16). A HARD target is either
 * unenforceable regardless of catalog knowledge (an inapplicable target or
 * one with no producer) or it requires target knowledge to prove
 * compatibility.
 */
export type HardConstraintClassification =
  | { kind: 'UNENFORCEABLE'; missingKnowledge: HardConstraintMissingKnowledge }
  | { kind: 'REQUIRES_TARGET_KNOWLEDGE' };

export function classifyHardTarget(
  target: SemanticTarget,
): HardConstraintClassification {
  const applicability = targetApplicability(target);
  return applicability.kind === 'ENFORCEABLE'
    ? { kind: 'REQUIRES_TARGET_KNOWLEDGE' }
    : { kind: 'UNENFORCEABLE', missingKnowledge: applicability.reason };
}

/**
 * Per-candidate compatibility of one applicable HARD target, reconciled from
 * each candidate's required-component observations and aggregated.
 */
export function evaluateHardTargetCompatibility(
  polarity: PreferencePolarity,
  candidatesObservations: readonly (readonly (readonly TargetObservation[])[])[],
): TargetCompatibility[] {
  return candidatesObservations.map((components) =>
    candidateTargetCompatibility(polarity, components),
  );
}

/** The post-catalog outcome of one applicable HARD target. */
export type HardTargetEligibility =
  | { kind: 'ELIGIBLE'; compatibleIndexes: number[] }
  | {
      kind: 'UNENFORCEABLE';
      missingKnowledge:
        | 'TARGET_KNOWLEDGE_UNKNOWN'
        | 'INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY';
      unknownReason?: UnknownTargetReason;
    };

/**
 * Resolve one applicable HARD target over the offered candidates. A candidate
 * is proven compatible only when its aggregated knowledge is COMPATIBLE;
 * UNKNOWN is never compatible. When nothing is proven compatible the outcome
 * distinguishes "no knowledge" (every candidate UNKNOWN) from "knowledge but
 * insufficient proven-compatible capacity" (some incompatible, none
 * compatible). The underlying UNKNOWN reason is retained, never collapsed.
 */
export function resolveHardTargetEligibility(
  polarity: PreferencePolarity,
  candidatesObservations: readonly (readonly (readonly TargetObservation[])[])[],
): HardTargetEligibility {
  const compatibility = evaluateHardTargetCompatibility(
    polarity,
    candidatesObservations,
  );
  const compatibleIndexes: number[] = [];
  let sawIncompatible = false;
  const unknownReasons = new Set<UnknownTargetReason>();

  compatibility.forEach((state, index) => {
    if (state === 'COMPATIBLE') {
      compatibleIndexes.push(index);
    } else if (state === 'INCOMPATIBLE') {
      sawIncompatible = true;
    } else {
      collectUnknownReasons(candidatesObservations[index], unknownReasons);
    }
  });

  if (compatibleIndexes.length > 0) {
    return { kind: 'ELIGIBLE', compatibleIndexes };
  }
  if (sawIncompatible) {
    return {
      kind: 'UNENFORCEABLE',
      missingKnowledge: 'INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY',
    };
  }
  return {
    kind: 'UNENFORCEABLE',
    missingKnowledge: 'TARGET_KNOWLEDGE_UNKNOWN',
    unknownReason: dominantUnknownReason(unknownReasons),
  };
}

function collectUnknownReasons(
  components: readonly (readonly TargetObservation[])[],
  reasons: Set<UnknownTargetReason>,
): void {
  for (const observations of components) {
    const knowledge = reconcileTargetKnowledge(observations);
    if (knowledge.state === 'UNKNOWN') {
      reasons.add(knowledge.reason);
    }
  }
}

function dominantUnknownReason(
  reasons: ReadonlySet<UnknownTargetReason>,
): UnknownTargetReason {
  if (reasons.has('INCONCLUSIVE_EVIDENCE')) return 'INCONCLUSIVE_EVIDENCE';
  if (reasons.has('CONFLICTING_EVIDENCE')) return 'CONFLICTING_EVIDENCE';
  return 'NO_EVIDENCE';
}
