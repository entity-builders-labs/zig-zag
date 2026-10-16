import { SemanticTarget } from '../preferences/preference-assertion.interface';
import { PREFERENCE_DIMENSIONS } from '../preferences/preference-facet-vocabulary';

/**
 * Typed missing-knowledge reasons for HARD constraints (task 25.7, owner
 * 2026-10-16). This cleanly replaces the former CLASSIFICATION_COMPLETENESS
 * reason; the underlying UNKNOWN reasons (NO_EVIDENCE / CONFLICTING_EVIDENCE /
 * INCONCLUSIVE_EVIDENCE) stay on the reconciled TargetKnowledge.
 */
export type HardConstraintMissingKnowledge =
  /** No structured producer maps this target to provider facts yet. */
  | 'TARGET_PRODUCER_UNAVAILABLE'
  /** The target has no declared Experience-level applicability yet. */
  | 'TARGET_APPLICABILITY_UNKNOWN'
  /** The target is applicable and produced, but knowledge is UNKNOWN. */
  | 'TARGET_KNOWLEDGE_UNKNOWN'
  /** No offered Experience can be proven compatible with the target. */
  | 'INSUFFICIENT_PROVEN_COMPATIBLE_CAPACITY'
  /** An open concept with no typed identity shared with Experience facts. */
  | 'SHARED_CONCEPT_IDENTITY';

export type TargetApplicability =
  | { kind: 'ENFORCEABLE' }
  | { kind: 'UNENFORCEABLE'; reason: HardConstraintMissingKnowledge };

/**
 * Explicit per-target applicability (task 25.7, owner 2026-10-16). There is
 * no general applicability model: 25.7 enforces only targets whose
 * applicability is already universal/unambiguous.
 *
 * - accessibility:wheelchair_access is enforceable once target knowledge
 *   exists.
 * - accessibility:avoid_stairs / limited_mobility have no structured producer
 *   (never derived from wheelchair=*).
 * - theme / intent have no HARD-proof producer: semantic classification is
 *   SOFT-only and is never bridged into target assessments.
 * - dietary_suitability:vegan and the remaining closed dimensions have a
 *   producer but no Experience-level applicability yet.
 */
export function targetApplicability(
  target: SemanticTarget,
): TargetApplicability {
  if (target.dimension === PREFERENCE_DIMENSIONS.ACCESSIBILITY) {
    if (target.key === 'wheelchair_access') {
      return { kind: 'ENFORCEABLE' };
    }
    return { kind: 'UNENFORCEABLE', reason: 'TARGET_PRODUCER_UNAVAILABLE' };
  }
  if (
    target.dimension === PREFERENCE_DIMENSIONS.THEME ||
    target.dimension === PREFERENCE_DIMENSIONS.INTENT
  ) {
    return { kind: 'UNENFORCEABLE', reason: 'TARGET_PRODUCER_UNAVAILABLE' };
  }
  return { kind: 'UNENFORCEABLE', reason: 'TARGET_APPLICABILITY_UNKNOWN' };
}
