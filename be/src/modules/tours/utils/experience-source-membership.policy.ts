import {
  ExperienceComponentResolutionReason,
  ExperienceComponentResolutionState,
} from '@prisma/client';
import { ComponentDeficitReason } from '../interfaces/experience-resolution.interface';
import { MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS } from './acquisition-candidate-requirement.util';
import { isPartialEligibleDeficit } from './component-deficit-classification.policy';

/**
 * The single membership authority for an Experience composition.
 *
 * An `ExperienceComponent` is one SOURCE-DECLARED member, resolved or not.
 * Two members may resolve to the same GeoEntity ("Caminito" and "Caminito
 * Street"), so a row count is never a count of places. Every reader asks
 * here instead of testing `geoEntityId != null` or `components.length`:
 *
 *  - allSourceMembers: every member, in source order;
 *  - resolvedSourceMembers: members with a canonical GeoEntity, in source
 *    order (the only members that may become navigable POIs, coordinates,
 *    duration, embedding text or Tour snapshot rows);
 *  - unresolvedSourceMembers: members still waiting for knowledge;
 *  - distinctResolvedGeoEntityIds: the places the composition really spans;
 *  - distinctResolvedSourceMembers: the first resolved member of each
 *    distinct GeoEntity, in source order. The NAVIGABLE view of the
 *    composition: projection, ranking, planner, embedding and Tour snapshot
 *    read it, so two source members on one GeoEntity never become two stops;
 *  - isCompositeMembership: at least two DISTINCT resolved GeoEntities;
 *  - sourceCompositionCompleteness: COMPLETE when every member is resolved,
 *    else PARTIAL. Derived from the rows, never stored.
 *
 * `decideSourceCompositionAdmission` applies the same rules to a candidate
 * before persistence.
 */

export interface SourceMemberShape {
  geoEntityId?: string | null;
  /** Absent on in-memory shapes that predate the column: RESOLVED by DB default. */
  resolutionState?: ExperienceComponentResolutionState | null;
  /** Null on legacy rows, whose source position was never recorded. */
  sourcePosition?: number | null;
}

export interface SourceMembershipHolder<M extends SourceMemberShape> {
  components: readonly M[];
}

export type ResolvedSourceMember<M extends SourceMemberShape> = M & {
  geoEntityId: string;
};

export type SourceCompositionCompleteness = 'COMPLETE' | 'PARTIAL';

export function isResolvedSourceMember<M extends SourceMemberShape>(
  member: M,
): member is ResolvedSourceMember<M> {
  return (
    member.resolutionState !== 'UNRESOLVED' &&
    typeof member.geoEntityId === 'string' &&
    member.geoEntityId.length > 0
  );
}

/**
 * Every source member in source order. Rows without a recorded position
 * (legacy) keep their stored relative order after positioned rows; an
 * Experience is either fully positioned or fully legacy, so the two never
 * interleave in practice.
 */
export function allSourceMembers<M extends SourceMemberShape>(
  experience: SourceMembershipHolder<M>,
): M[] {
  return [...experience.components].sort((left, right) => {
    const a = left.sourcePosition;
    const b = right.sourcePosition;
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a - b;
  });
}

export function resolvedSourceMembers<M extends SourceMemberShape>(
  experience: SourceMembershipHolder<M>,
): Array<ResolvedSourceMember<M>> {
  return allSourceMembers(experience).filter(isResolvedSourceMember);
}

export function unresolvedSourceMembers<M extends SourceMemberShape>(
  experience: SourceMembershipHolder<M>,
): M[] {
  return allSourceMembers(experience).filter(
    (member) => !isResolvedSourceMember(member),
  );
}

/**
 * The first resolved member of each distinct GeoEntity, in source order:
 * the navigable places of the composition.
 */
export function distinctResolvedSourceMembers<M extends SourceMemberShape>(
  experience: SourceMembershipHolder<M>,
): Array<ResolvedSourceMember<M>> {
  const seen = new Set<string>();
  return resolvedSourceMembers(experience).filter((member) => {
    if (seen.has(member.geoEntityId)) return false;
    seen.add(member.geoEntityId);
    return true;
  });
}

/** Distinct resolved GeoEntity ids, in first source-order occurrence. */
export function distinctResolvedGeoEntityIds<M extends SourceMemberShape>(
  experience: SourceMembershipHolder<M>,
): string[] {
  return [
    ...new Set(
      resolvedSourceMembers(experience).map((member) => member.geoEntityId),
    ),
  ];
}

export function isCompositeMembership<M extends SourceMemberShape>(
  experience: SourceMembershipHolder<M>,
): boolean {
  return (
    distinctResolvedGeoEntityIds(experience).length >=
    MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS
  );
}

export function sourceCompositionCompleteness<M extends SourceMemberShape>(
  experience: SourceMembershipHolder<M>,
): SourceCompositionCompleteness {
  return unresolvedSourceMembers(experience).length === 0
    ? 'COMPLETE'
    : 'PARTIAL';
}

/** A runtime deficit, or the persisted reason of an unresolved member. */
export type SourceMemberDeficitReason =
  | ComponentDeficitReason
  | ExperienceComponentResolutionReason;

/** One source member as resolution (or persistence) left it. */
export type SourceMemberResolution =
  | { identityStatus: 'RESOLVED'; geoEntityId?: string }
  | {
      identityStatus: 'UNRESOLVED' | 'AMBIGUOUS' | 'CONFLICTED';
      deficitReason: SourceMemberDeficitReason;
    };

export type SourceCompositionAdmission =
  | {
      admitted: true;
      completeness: SourceCompositionCompleteness;
      distinctResolvedGeoEntityIds: string[];
    }
  | {
      admitted: false;
      /**
       * NO_MEMBERS: the source declared no member. NO_RESOLVED_MEMBER:
       * nothing resolved. BELOW_DISTINCT_FLOOR: incomplete, and fewer than
       * two distinct GeoEntities resolved. BLOCKING_DEFICIT: incomplete, and
       * an unresolved member is not missing knowledge.
       */
      reason:
        | 'NO_MEMBERS'
        | 'NO_RESOLVED_MEMBER'
        | 'BELOW_DISTINCT_FLOOR'
        | 'BLOCKING_DEFICIT';
      distinctResolvedGeoEntityIds: string[];
      blockingReasons: SourceMemberDeficitReason[];
    };

/**
 * Admission of a source-defined composition:
 *  - COMPLETE (every member resolved) is admitted as before, single-member
 *    Experiences included;
 *  - PARTIAL is admitted only when at least two DISTINCT GeoEntities
 *    resolved AND every unresolved member is PARTIAL-eligible (missing
 *    knowledge). No percentage threshold. Two members resolving to one
 *    GeoEntity count once.
 */
export function decideSourceCompositionAdmission(
  members: readonly SourceMemberResolution[],
): SourceCompositionAdmission {
  const distinct = [
    ...new Set(
      members.flatMap((member) =>
        member.identityStatus === 'RESOLVED' && member.geoEntityId
          ? [member.geoEntityId]
          : [],
      ),
    ),
  ];
  const unresolved = members.filter(
    (
      member,
    ): member is Extract<
      SourceMemberResolution,
      { deficitReason: SourceMemberDeficitReason }
    > => member.identityStatus !== 'RESOLVED',
  );
  const blockingReasons = [
    ...new Set(
      unresolved
        .map((member) => member.deficitReason)
        .filter((reason) => !isPartialEligibleDeficit(reason)),
    ),
  ];
  const rejected = (
    reason: Extract<SourceCompositionAdmission, { admitted: false }>['reason'],
  ): SourceCompositionAdmission => ({
    admitted: false,
    reason,
    distinctResolvedGeoEntityIds: distinct,
    blockingReasons,
  });

  if (members.length === 0) return rejected('NO_MEMBERS');
  if (unresolved.length === members.length) {
    return rejected('NO_RESOLVED_MEMBER');
  }
  if (unresolved.length === 0) {
    return {
      admitted: true,
      completeness: 'COMPLETE',
      distinctResolvedGeoEntityIds: distinct,
    };
  }
  if (distinct.length < MULTI_COMPONENT_MIN_DISTINCT_COMPONENTS) {
    return rejected('BELOW_DISTINCT_FLOOR');
  }
  if (blockingReasons.length > 0) return rejected('BLOCKING_DEFICIT');
  return {
    admitted: true,
    completeness: 'PARTIAL',
    distinctResolvedGeoEntityIds: distinct,
  };
}
