import { PreferenceSpec } from '../interfaces/preference-spec.interface';
import {
  PreferencePolarityConflict,
  SemanticTarget,
} from '../preferences/preference-assertion.interface';

/** Knowledge that would be needed to guarantee a hard constraint. */
export type MissingConstraintKnowledge =
  /**
   * The catalog does not record whether an Experience's typed facts are
   * complete, so absence of a fact cannot prove compatibility.
   */
  | 'CLASSIFICATION_COMPLETENESS'
  /** The concept has no typed identity shared with Experience facts. */
  | 'SHARED_CONCEPT_IDENTITY';

export interface UnenforceableHardConstraint {
  /** The typed target, or null for an unresolved open concept. */
  target: SemanticTarget | null;
  /** The extractor's description of an unresolved concept (trace only). */
  unresolvedLabel: string | null;
  polarity: 'INCLUDE' | 'EXCLUDE';
  missingKnowledge: MissingConstraintKnowledge;
  reason: 'COMPATIBILITY_CANNOT_BE_PROVEN';
}

/**
 * Hard constraints (HARD assertions and HARD unresolved concepts) the request
 * cannot currently guarantee. Unknown compatibility is never compatibility:
 * until the catalog records classification completeness (and a shared typed
 * concept space exists for open concepts), no Experience can be proven
 * compatible, so every hard constraint is unenforceable.
 */
export function findUnenforceableHardConstraints(
  spec: Pick<PreferenceSpec, 'assertions' | 'unresolvedConcepts'>,
): UnenforceableHardConstraint[] {
  return [
    ...spec.assertions
      .filter((assertion) => assertion.constraint === 'HARD')
      .map(
        (assertion): UnenforceableHardConstraint => ({
          target: assertion.target,
          unresolvedLabel: null,
          polarity: assertion.polarity,
          missingKnowledge: 'CLASSIFICATION_COMPLETENESS',
          reason: 'COMPATIBILITY_CANNOT_BE_PROVEN',
        }),
      ),
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
