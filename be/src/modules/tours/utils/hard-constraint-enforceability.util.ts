import { PreferenceSpec } from '../interfaces/preference-spec.interface';
import {
  PreferencePolarityConflict,
  SemanticTarget,
} from '../preferences/preference-assertion.interface';
import { UnknownTargetReason } from '../preferences/target-knowledge.interface';
import {
  HardConstraintMissingKnowledge,
  targetApplicability,
} from './target-applicability.util';

/**
 * A hard constraint the request cannot guarantee (task 25.7, owner
 * 2026-10-16). The typed `missingKnowledge` reason is never collapsed; the
 * underlying UNKNOWN reason stays on the reconciled target knowledge.
 */
export interface UnenforceableHardConstraint {
  /** The typed target, or null for an unresolved open concept. */
  target: SemanticTarget | null;
  /** The extractor's description of an unresolved concept (trace only). */
  unresolvedLabel: string | null;
  polarity: 'INCLUDE' | 'EXCLUDE';
  missingKnowledge: HardConstraintMissingKnowledge;
  /** Underlying UNKNOWN reason when missingKnowledge is TARGET_KNOWLEDGE_UNKNOWN. */
  unknownReason?: UnknownTargetReason;
  reason: 'COMPATIBILITY_CANNOT_BE_PROVEN';
}

/**
 * Hard constraints the request cannot currently guarantee, without catalog
 * target knowledge. Unknown compatibility is never compatibility: an
 * inapplicable target, a target without a producer, an unresolved concept, or
 * a target with no reconciled knowledge fails closed with a typed reason.
 * Catalog evaluation of the applicable accessibility:wheelchair_access target
 * is the orchestration wiring step; until it is wired, every hard constraint
 * fails closed.
 */
export function findUnenforceableHardConstraints(
  spec: Pick<PreferenceSpec, 'assertions' | 'unresolvedConcepts'>,
): UnenforceableHardConstraint[] {
  return [
    ...spec.assertions
      .filter((assertion) => assertion.constraint === 'HARD')
      .map((assertion): UnenforceableHardConstraint => {
        const applicability = targetApplicability(assertion.target);
        let missingKnowledge: HardConstraintMissingKnowledge;
        let unknownReason: UnknownTargetReason | undefined;
        if (applicability.kind === 'ENFORCEABLE') {
          missingKnowledge = 'TARGET_KNOWLEDGE_UNKNOWN';
          unknownReason = 'NO_EVIDENCE';
        } else {
          missingKnowledge = applicability.reason;
        }
        const unenforceable: UnenforceableHardConstraint = {
          target: assertion.target,
          unresolvedLabel: null,
          polarity: assertion.polarity,
          missingKnowledge,
          reason: 'COMPATIBILITY_CANNOT_BE_PROVEN',
        };
        if (unknownReason) {
          unenforceable.unknownReason = unknownReason;
        }
        return unenforceable;
      }),
    ...spec.unresolvedConcepts
      .filter((concept) => concept.constraint === 'HARD')
      .map(
        (concept): UnenforceableHardConstraint => ({
          target: null,
          unresolvedLabel: concept.label,
          polarity: concept.polarity,
          missingKnowledge: 'SHARED_CONCEPT_IDENTITY',
          reason: 'COMPATIBILITY_CANNOT_BE_PROVEN',
        }),
      ),
  ];
}

/**
 * The typed generation outcome when a hard constraint cannot be guaranteed:
 * distinct from an infeasible or empty Tour. Nothing is planned.
 */
export class HardConstraintUnenforceableError extends Error {
  readonly outcome = 'HARD_CONSTRAINT_UNENFORCEABLE' as const;
  /** Retrying cannot change the outcome until the missing knowledge exists. */
  readonly retryable = false;

  constructor(
    readonly constraints: UnenforceableHardConstraint[],
    readonly destination: string,
  ) {
    super(
      `HARD_CONSTRAINT_UNENFORCEABLE: ${constraints.length} hard constraint(s) cannot be guaranteed for ${destination} (${constraints
        .map((constraint) =>
          constraint.target
            ? `${constraint.target.dimension}:${constraint.target.key} ${constraint.missingKnowledge}`
            : `unresolved concept ${constraint.missingKnowledge}`,
        )
        .join('; ')})`,
    );
    this.name = 'HardConstraintUnenforceableError';
  }
}

/**
 * Targets the request asserts both as INCLUDE and as EXCLUDE where either
 * assertion is HARD. Planning cannot safely tell which one governs, so these
 * block generation; nothing decides between them deterministically.
 */
export function findAmbiguousHardConstraints(
  spec: Pick<PreferenceSpec, 'polarityConflicts'>,
): PreferencePolarityConflict[] {
  return spec.polarityConflicts.filter((conflict) => conflict.blocking);
}

/**
 * The typed generation outcome for contradictory hard intent: the request
 * was understood, but two incompatible assertions govern the same target.
 * Distinct from HARD_CONSTRAINT_UNENFORCEABLE (clear intent, unprovable
 * compatibility). Nothing is planned and retrying cannot resolve it.
 */
export class AmbiguousHardConstraintError extends Error {
  readonly outcome = 'AMBIGUOUS_HARD_CONSTRAINT' as const;
  readonly retryable = false;

  constructor(
    readonly conflicts: PreferencePolarityConflict[],
    readonly destination: string,
  ) {
    super(
      `AMBIGUOUS_HARD_CONSTRAINT: ${conflicts.length} target(s) asserted both as INCLUDE and EXCLUDE with a hard constraint for ${destination} (${conflicts
        .map(
          (conflict) => `${conflict.target.dimension}:${conflict.target.key}`,
        )
        .join('; ')})`,
    );
    this.name = 'AmbiguousHardConstraintError';
  }
}
