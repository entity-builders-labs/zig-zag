import { ExperienceComponentResolutionReason } from '@prisma/client';
import {
  ComponentDeficitClass,
  ComponentDeficitClassification,
  ComponentDeficitReason,
} from '../interfaces/experience-resolution.interface';

/**
 * The single classification authority for why a source member has no
 * canonical GeoEntity. Two independent axes are derived from one typed
 * reason, here and nowhere else:
 *
 *  - `deficitClassification`: the research axis. Only genuine world-knowledge
 *    ambiguity feeds the Tourism Researcher; a provider that could not run is
 *    operational; everything else stays pending forensic review.
 *  - `componentDeficitClass`: the composition axis. It decides whether an
 *    unresolved mandatory member may stay unresolved inside a persisted
 *    PARTIAL composite (`isPartialEligibleDeficit`).
 *
 * Both are exhaustive switches with no default: a new reason does not
 * compile until it is classified on both axes.
 */
export function deficitClassification(
  reason: ComponentDeficitReason,
): ComponentDeficitClassification {
  switch (reason) {
    case 'AMBIGUOUS_CANDIDATES':
      return 'KNOWLEDGE_DEFICIT';
    case 'PROVIDER_FAILURE':
    case 'IDENTITY_AUTHORITY_UNAVAILABLE':
      return 'OPERATIONAL_FAILURE';
    case 'NO_CANDIDATE_ACQUIRED':
    case 'CANDIDATE_UNCONFIRMED':
    case 'CANDIDATE_REJECTED':
    case 'IDENTITY_CONFLICT':
    case 'DESTINATION_INCOMPATIBLE':
    case 'DESTINATION_COMPATIBILITY_UNKNOWN':
      return 'PENDING_CLASSIFICATION';
  }
}

/**
 * Producing branches (`componentDeficitReason` in
 * component-resolution-facts.util.ts, and the resolver branches that set
 * `ResolvedGeoEntity.reason`):
 *
 *  - MISSING_KNOWLEDGE: nothing admissible was found
 *    (NO_CANDIDATE_ACQUIRED), a candidate was found but not corroborated
 *    (CANDIDATE_UNCONFIRMED), several real objects compete with no winner
 *    (AMBIGUOUS_CANDIDATES), or every acquired CANDIDATE was disproven
 *    (CANDIDATE_REJECTED). A rejected candidate is a candidate-level
 *    contradiction: no GeoEntity was linked and nothing was said against the
 *    source member itself. An administrator revoking the member's
 *    resolution (RESOLUTION_REVOKED, persisted only) also leaves missing
 *    knowledge.
 *  - CONTRADICTORY_EVIDENCE: the verified candidate's strong identities are
 *    owned by several GeoEntities (IDENTITY_CONFLICT), or the source's own
 *    AREA lies outside / is coarser than the destination
 *    (DESTINATION_INCOMPATIBLE).
 *  - UNKNOWN: the destination geography needed to judge the member is
 *    unknown (DESTINATION_COMPATIBILITY_UNKNOWN).
 *  - SYSTEM_FAILURE: an acquisition provider failed (PROVIDER_FAILURE) or
 *    the identity authority was unavailable when the verdict needed it
 *    (IDENTITY_AUTHORITY_UNAVAILABLE). A transient failure never becomes
 *    durable domain incompleteness.
 *  - INVALID_SOURCE_COMPONENT: no runtime branch produces it yet.
 *    Descriptive non-names currently arrive as NO_CANDIDATE_ACQUIRED;
 *    typing them is an extraction concern.
 */
export function componentDeficitClass(
  reason: ComponentDeficitReason | ExperienceComponentResolutionReason,
): ComponentDeficitClass {
  switch (reason) {
    case 'NO_CANDIDATE_ACQUIRED':
    case 'CANDIDATE_UNCONFIRMED':
    case 'AMBIGUOUS_CANDIDATES':
    case 'CANDIDATE_REJECTED':
    case 'RESOLUTION_REVOKED':
      return 'MISSING_KNOWLEDGE';
    case 'IDENTITY_CONFLICT':
    case 'DESTINATION_INCOMPATIBLE':
      return 'CONTRADICTORY_EVIDENCE';
    case 'DESTINATION_COMPATIBILITY_UNKNOWN':
      return 'UNKNOWN';
    case 'PROVIDER_FAILURE':
    case 'IDENTITY_AUTHORITY_UNAVAILABLE':
      return 'SYSTEM_FAILURE';
  }
}

/** Only MISSING_KNOWLEDGE may stay unresolved inside a PARTIAL composite. */
export function isPartialEligibleDeficit(
  reason: ComponentDeficitReason | ExperienceComponentResolutionReason,
): boolean {
  return componentDeficitClass(reason) === 'MISSING_KNOWLEDGE';
}

/**
 * The persisted reason of a PARTIAL-eligible runtime deficit. The Prisma
 * enum holds exactly the eligible reasons, so a blocking reason has no
 * persisted form and returns undefined.
 */
export function persistableUnresolvedReason(
  reason: ComponentDeficitReason,
): ExperienceComponentResolutionReason | undefined {
  switch (reason) {
    case 'NO_CANDIDATE_ACQUIRED':
    case 'CANDIDATE_UNCONFIRMED':
    case 'CANDIDATE_REJECTED':
    case 'AMBIGUOUS_CANDIDATES':
      return reason;
    case 'IDENTITY_CONFLICT':
    case 'DESTINATION_INCOMPATIBLE':
    case 'DESTINATION_COMPATIBILITY_UNKNOWN':
    case 'PROVIDER_FAILURE':
    case 'IDENTITY_AUTHORITY_UNAVAILABLE':
      return undefined;
  }
}
