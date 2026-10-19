import {
  ChildPlaceClass,
  DEFAULT_VISIT_UNITS,
  ParentPlaceClass,
  RelationshipClassKey,
  VisitUnit,
} from './structured-admission-policy';

export const PARENT_SITE_VISIT_UNIT_POLICY_VERSION =
  'parent-site-visit-unit-v1';

/**
 * Parent/child visit-unit policy (design C5, R4-D2 RESOLVED). Decides whether
 * a child place is its own schedulable Experience or is represented by a
 * parent site. Structured evidence only: proximity, names, embeddings, LLM
 * output and web research never establish or classify a relationship.
 */

/** How a child's relationship to a parent-site candidate was established. */
export type ParentRelationshipBasis =
  | { kind: 'EXPLICIT_PROVIDER_RELATIONSHIP' }
  | { kind: 'CONTAINMENT' };

export interface ParentSiteCandidate {
  parentId: string;
  parentClass: ParentPlaceClass;
  basis: ParentRelationshipBasis;
}

/**
 * Per-instance structured evidence that a child is independently visitable.
 * A name or coordinates alone never establish independent visitability.
 */
export interface PerInstanceEvidence {
  separateEntrance?: boolean;
  separateOpeningHours?: boolean;
  separateProviderIdentity?: boolean;
  explicitVenueEvidence?: boolean;
}

export type ChildVisitUnitOutcome =
  | {
      outcome: 'SUB_FEATURE_OF';
      parentId: string;
      visitUnit: Extract<VisitUnit, 'CHILD_REQUIRES_PARENT_VISIT'>;
    }
  | {
      outcome: 'PARENT_NOT_ADMITTED';
      parentId: string;
      visitUnit: Extract<VisitUnit, 'CHILD_REQUIRES_PARENT_VISIT'>;
    }
  | { outcome: 'AMBIGUOUS_PARENT_RELATIONSHIP' }
  | { outcome: 'INDEPENDENTLY_VISITABLE'; partOfParentIds: string[] }
  | { outcome: 'NO_PARENT_RELATIONSHIP' };

function declaredRelationshipClass(
  childClass: ChildPlaceClass,
  parentClass: ParentPlaceClass,
): VisitUnit | undefined {
  return DEFAULT_VISIT_UNITS[
    `${childClass}:${parentClass}` as RelationshipClassKey
  ];
}

function evidenceForIndependent(evidence: PerInstanceEvidence): boolean {
  return Boolean(
    evidence.separateEntrance ||
      evidence.separateOpeningHours ||
      evidence.separateProviderIdentity ||
      evidence.explicitVenueEvidence,
  );
}

/**
 * Classifies one established child→parent relationship and resolves the
 * child's outcome against the parent's admission state.
 */
export function evaluateChildVisitUnit(input: {
  childClass: ChildPlaceClass;
  /** The child's plausible DIRECT visit parents (never ancestors). */
  parents: readonly ParentSiteCandidate[];
  perInstanceEvidence?: PerInstanceEvidence;
  parentAdmitted: ReadonlyMap<string, boolean>;
}): ChildVisitUnitOutcome {
  const evidence = input.perInstanceEvidence ?? {};

  // Establish relationships (structured only). Containment counts only when a
  // (child class, parent class) relationship class is declared in the policy;
  // containment without one establishes no relationship
  // (CONTAINMENT_WITHOUT_RELATIONSHIP).
  const valid = input.parents.filter((parent) => {
    if (parent.basis.kind === 'EXPLICIT_PROVIDER_RELATIONSHIP') return true;
    return (
      declaredRelationshipClass(input.childClass, parent.parentClass) !==
      undefined
    );
  });

  if (valid.length === 0) {
    return { outcome: 'NO_PARENT_RELATIONSHIP' };
  }

  // Several distinct plausible direct visit parents → fail closed.
  const distinctParents = [...new Set(valid.map((parent) => parent.parentId))];
  if (distinctParents.length > 1) {
    return { outcome: 'AMBIGUOUS_PARENT_RELATIONSHIP' };
  }

  const parent = valid[0];
  const parentId = parent.parentId;
  const defaultUnit = declaredRelationshipClass(
    input.childClass,
    parent.parentClass,
  );
  const independent = evidenceForIndependent(evidence);

  // Classify the visit unit: policy default and per-instance evidence. Decide
  // when they agree or only one exists; contradict or neither → ambiguous.
  let visitUnit: VisitUnit;
  if (defaultUnit === 'CHILD_INDEPENDENTLY_VISITABLE') {
    visitUnit = 'CHILD_INDEPENDENTLY_VISITABLE';
  } else if (defaultUnit === 'CHILD_REQUIRES_PARENT_VISIT') {
    if (independent) {
      // default REQUIRES but per-instance evidence says independent → contradict.
      return { outcome: 'AMBIGUOUS_PARENT_RELATIONSHIP' };
    }
    visitUnit = 'CHILD_REQUIRES_PARENT_VISIT';
  } else if (independent) {
    visitUnit = 'CHILD_INDEPENDENTLY_VISITABLE';
  } else {
    // Neither a declared default nor per-instance evidence suffices.
    return { outcome: 'AMBIGUOUS_PARENT_RELATIONSHIP' };
  }

  if (visitUnit === 'CHILD_INDEPENDENTLY_VISITABLE') {
    return {
      outcome: 'INDEPENDENTLY_VISITABLE',
      partOfParentIds: [parentId],
    };
  }

  // CHILD_REQUIRES_PARENT_VISIT: the child is represented by its parent.
  const admitted = input.parentAdmitted.get(parentId) === true;
  return admitted
    ? {
        outcome: 'SUB_FEATURE_OF',
        parentId,
        visitUnit: 'CHILD_REQUIRES_PARENT_VISIT',
      }
    : {
        outcome: 'PARENT_NOT_ADMITTED',
        parentId,
        visitUnit: 'CHILD_REQUIRES_PARENT_VISIT',
      };
}
