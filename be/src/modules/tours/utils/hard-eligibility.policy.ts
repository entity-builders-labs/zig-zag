import {
  PreferencePolarity,
  SemanticTarget,
  semanticTargetKey,
} from '../preferences/preference-assertion.interface';
import {
  TargetCompatibility,
  TargetKnowledge,
  UnknownTargetReason,
} from '../preferences/target-knowledge.interface';
import {
  HardConstraintMissingKnowledge,
  targetApplicability,
} from './target-applicability.util';
import { hardTargetCompatibility } from './target-composite-aggregation.util';

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
 * Per-candidate compatibility of one applicable HARD target, aggregated from
 * each candidate's already-reconciled required-component knowledge. This is
 * aggregation only: reconciliation happens once at the catalog projection
 * boundary (the single reconciliation authority).
 */
export function evaluateHardTargetCompatibility(
  polarity: PreferencePolarity,
  candidatesKnowledge: readonly (readonly TargetKnowledge[])[],
): TargetCompatibility[] {
  return candidatesKnowledge.map((componentKnowledge) =>
    hardTargetCompatibility(polarity, componentKnowledge),
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
  candidatesKnowledge: readonly (readonly TargetKnowledge[])[],
): HardTargetEligibility {
  const compatibility = evaluateHardTargetCompatibility(
    polarity,
    candidatesKnowledge,
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
      collectUnknownReasons(candidatesKnowledge[index], unknownReasons);
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
  componentKnowledge: readonly TargetKnowledge[],
  reasons: Set<UnknownTargetReason>,
): void {
  for (const knowledge of componentKnowledge) {
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

/** A candidate whose components carry reconciled target knowledge. */
export interface HardEligibleCandidate {
  targetKnowledge: readonly {
    byTarget: Readonly<Record<string, TargetKnowledge>>;
  }[];
}

/** The post-catalog outcome over one or more applicable HARD targets. */
export type MultiTargetHardEligibility =
  | { kind: 'ELIGIBLE'; compatibleIndexes: number[] }
  | {
      kind: 'UNENFORCEABLE';
      target: SemanticTarget;
      polarity: PreferencePolarity;
      missingKnowledge:
        | 'TARGET_KNOWLEDGE_UNKNOWN'
        | 'INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY';
      unknownReason?: UnknownTargetReason;
    };

const NO_EVIDENCE: TargetKnowledge = {
  state: 'UNKNOWN',
  reason: 'NO_EVIDENCE',
};

/**
 * Resolve every applicable HARD target over the offered candidates: a
 * candidate is proven compatible only when it is COMPATIBLE with every
 * applicable target (UNKNOWN is never compatible). The first target with no
 * compatible candidate decides the unenforceable outcome; otherwise the
 * intersection of compatible indexes is returned.
 */
export function resolveHardEligibility(
  applicable: readonly {
    target: SemanticTarget;
    polarity: PreferencePolarity;
  }[],
  candidates: readonly HardEligibleCandidate[],
): MultiTargetHardEligibility {
  let compatibleIndexes: number[] | null = null;
  for (const { target, polarity } of applicable) {
    const key = semanticTargetKey(target);
    const candidatesKnowledge = candidates.map((candidate) =>
      candidate.targetKnowledge.map(
        (component) => component.byTarget[key] ?? NO_EVIDENCE,
      ),
    );
    const outcome = resolveHardTargetEligibility(polarity, candidatesKnowledge);
    if (outcome.kind === 'UNENFORCEABLE') {
      return {
        kind: 'UNENFORCEABLE',
        target,
        polarity,
        missingKnowledge: outcome.missingKnowledge,
        ...(outcome.unknownReason
          ? { unknownReason: outcome.unknownReason }
          : {}),
      };
    }
    const compatible = new Set(outcome.compatibleIndexes);
    compatibleIndexes =
      compatibleIndexes === null
        ? [...compatible]
        : compatibleIndexes.filter((index) => compatible.has(index));
  }
  return {
    kind: 'ELIGIBLE',
    compatibleIndexes: compatibleIndexes ?? candidates.map((_, index) => index),
  };
}
