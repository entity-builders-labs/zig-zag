import { ExperienceComponentResolutionReason } from '@prisma/client';
import {
  DedupeDecision,
  StructuralCompositionEvidence,
} from './experience-dedupe.util';

/**
 * THE source-knowledge reconciliation policy: what a later observation of
 * the SAME source-defined composition may teach the canonical Experience.
 *
 * UNION OF KNOWLEDGE, never UNION OF EXPERIENCES:
 *  - eligible only for a SAME identity decision over EXACT_COMPOSITION
 *    (identity authority stays with `decideExperienceDedupe`; a
 *    SUBCOMPOSITION, PARTIAL_OVERLAP, DISJOINT or shared URL never merges
 *    members);
 *  - a canonical UNRESOLVED member becomes RESOLVED when its corresponding
 *    incoming member resolved it (correspondence = the dedupe authority's
 *    `sharedSourceMembers`, never re-derived here);
 *  - a resolved member is never downgraded by an unresolved observation;
 *  - two different GeoEntities for one corresponding member is a CONFLICT:
 *    the whole observation contributes no member knowledge (no recency,
 *    provider or order tie-break);
 *  - an admin-revoked member is never re-learned automatically;
 *  - source identity (`sourcePosition`, `sourceName`, member count) never
 *    changes.
 *
 * Pure: the catalog applies the result inside its SAME transaction.
 */
export type SourceKnowledgeReconciliationOutcome =
  | 'ENRICHED'
  | 'NO_NEW_KNOWLEDGE'
  | 'CONFLICT_REJECTED'
  | 'NOT_ELIGIBLE';

export type SourceKnowledgeIneligibilityReason =
  | 'NOT_SAME_EXACT_COMPOSITION'
  | 'LEGACY_MEMBER_WITHOUT_SOURCE_POSITION'
  | 'INCOMPLETE_MEMBER_CORRESPONDENCE';

export type SourceMemberKnowledgeChange =
  | 'UNCHANGED'
  | 'RESOLVED_BY_OBSERVATION'
  | 'CONFLICT'
  | 'ADMIN_REVOKED_NOT_RELEARNED';

export interface SourceMemberResolutionSnapshot {
  resolutionState: 'RESOLVED' | 'UNRESOLVED';
  geoEntityId: string | null;
  resolutionReason: ExperienceComponentResolutionReason | null;
}

/** One persisted canonical member, as the reconciliation reads it. */
export interface CanonicalSourceMemberState
  extends SourceMemberResolutionSnapshot {
  sourcePosition: number | null;
  sourceName: string | null;
}

/** One member of the incoming observation; its array index is its position. */
export interface IncomingSourceMemberObservation {
  sourcePosition: number;
  sourceName: string | null;
  /** `null` when the observation left the member unresolved. */
  geoEntityId: string | null;
}

export interface SourceMemberReconciliation {
  sourcePosition: number;
  sourceName: string | null;
  before: SourceMemberResolutionSnapshot;
  after: SourceMemberResolutionSnapshot;
  change: SourceMemberKnowledgeChange;
  /** The GeoEntity the observation resolved this member to, if any. */
  observedGeoEntityId: string | null;
  incomingSourcePositions: number[];
}

export type SourceKnowledgeReconciliation =
  | {
      outcome: 'NOT_ELIGIBLE';
      reason: SourceKnowledgeIneligibilityReason;
      /** Always empty: nothing was reconciled. */
      members: SourceMemberReconciliation[];
    }
  | {
      outcome: Exclude<SourceKnowledgeReconciliationOutcome, 'NOT_ELIGIBLE'>;
      /** Every canonical member, in source order. */
      members: SourceMemberReconciliation[];
    };

export function reconcileSameSourceComposition(input: {
  identityDecision: DedupeDecision['decision'];
  structure: Pick<
    StructuralCompositionEvidence,
    'relation' | 'sharedSourceMembers'
  >;
  canonical: CanonicalSourceMemberState[];
  incoming: IncomingSourceMemberObservation[];
}): SourceKnowledgeReconciliation {
  const notEligible = (
    reason: SourceKnowledgeIneligibilityReason,
  ): SourceKnowledgeReconciliation => ({
    outcome: 'NOT_ELIGIBLE',
    reason,
    members: [],
  });

  if (
    input.identityDecision !== 'SAME' ||
    input.structure.relation !== 'EXACT_COMPOSITION'
  ) {
    return notEligible('NOT_SAME_EXACT_COMPOSITION');
  }
  if (input.canonical.some((member) => member.sourcePosition == null)) {
    return notEligible('LEGACY_MEMBER_WITHOUT_SOURCE_POSITION');
  }

  const canonicalByPosition = new Map(
    input.canonical.map((member) => [member.sourcePosition as number, member]),
  );
  const incomingByPosition = new Map(
    input.incoming.map((member) => [member.sourcePosition, member]),
  );
  const classes = input.structure.sharedSourceMembers.map((shared) => ({
    existing: shared.existingSourcePositions,
    incoming: shared.incomingSourcePositions,
  }));

  // EXACT_COMPOSITION means every member of each side has exactly one
  // correspondence class; anything else is not reconcilable knowledge.
  const covered = (
    positions: Array<Array<number | null>>,
    expected: number[],
  ): boolean => {
    const flat = positions.flat();
    return (
      flat.every((position) => position != null) &&
      new Set(flat).size === flat.length &&
      flat.length === expected.length &&
      expected.every((position) => flat.includes(position))
    );
  };
  if (
    !covered(
      classes.map((item) => item.existing),
      [...canonicalByPosition.keys()],
    ) ||
    !covered(
      classes.map((item) => item.incoming),
      [...incomingByPosition.keys()],
    )
  ) {
    return notEligible('INCOMPLETE_MEMBER_CORRESPONDENCE');
  }

  const distinctGeo = (geoIds: Array<string | null>) => [
    ...new Set(geoIds.filter((id): id is string => !!id)),
  ];
  const decided = new Map<number, SourceMemberReconciliation>();
  let conflict = false;

  for (const item of classes) {
    const incomingPositions = item.incoming as number[];
    const canonicalMembers = (item.existing as number[]).map(
      (position) => canonicalByPosition.get(position)!,
    );
    const observed = distinctGeo(
      incomingPositions.map(
        (position) => incomingByPosition.get(position)!.geoEntityId,
      ),
    );
    const known = distinctGeo(
      canonicalMembers.map((member) =>
        member.resolutionState === 'RESOLVED' ? member.geoEntityId : null,
      ),
    );
    const classConflict =
      observed.length > 1 ||
      known.length > 1 ||
      (observed.length === 1 && known.length === 1 && observed[0] !== known[0]);
    conflict ||= classConflict;
    const observedGeoEntityId = observed.length === 1 ? observed[0] : null;

    for (const member of canonicalMembers) {
      const before = snapshotOf(member);
      const change: SourceMemberKnowledgeChange = classConflict
        ? 'CONFLICT'
        : member.resolutionState === 'RESOLVED' || !observedGeoEntityId
          ? 'UNCHANGED'
          : member.resolutionReason === 'RESOLUTION_REVOKED'
            ? 'ADMIN_REVOKED_NOT_RELEARNED'
            : 'RESOLVED_BY_OBSERVATION';
      decided.set(member.sourcePosition as number, {
        sourcePosition: member.sourcePosition as number,
        sourceName: member.sourceName,
        before,
        after:
          change === 'RESOLVED_BY_OBSERVATION'
            ? {
                resolutionState: 'RESOLVED',
                geoEntityId: observedGeoEntityId,
                resolutionReason: null,
              }
            : before,
        change,
        observedGeoEntityId,
        incomingSourcePositions: [...incomingPositions],
      });
    }
  }

  const members = [...decided.values()].sort(
    (left, right) => left.sourcePosition - right.sourcePosition,
  );
  if (conflict) {
    // Fail closed: the observation contributes no member knowledge at all.
    return {
      outcome: 'CONFLICT_REJECTED',
      members: members.map((member) =>
        member.change === 'RESOLVED_BY_OBSERVATION'
          ? { ...member, after: member.before, change: 'UNCHANGED' }
          : member,
      ),
    };
  }
  return {
    outcome: members.some(
      (member) => member.change === 'RESOLVED_BY_OBSERVATION',
    )
      ? 'ENRICHED'
      : 'NO_NEW_KNOWLEDGE',
    members,
  };
}

function snapshotOf(
  member: CanonicalSourceMemberState,
): SourceMemberResolutionSnapshot {
  return {
    resolutionState: member.resolutionState,
    geoEntityId:
      member.resolutionState === 'RESOLVED' ? member.geoEntityId : null,
    resolutionReason: member.resolutionReason,
  };
}
