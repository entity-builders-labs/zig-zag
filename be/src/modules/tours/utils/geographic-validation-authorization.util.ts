import { AcquisitionDeficit } from '../interfaces/experience-acquisition-plan.interface';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  AuthorizedExperienceCandidate,
  GeographicGrantingWorkUnitKind,
  GeographicIntentDeficit,
  GeographicPolicyIntent,
  GeographicValidationAuthorization,
  OwnedIntentGeographicGrant,
  WorkUnitGeographicGrant,
} from '../interfaces/geographic-validation-authorization.interface';
import { candidateSatisfiesEvidenceRequirement } from './acquisition-candidate-requirement.util';

/**
 * THE single derivation of geographic validation authorization. See
 * `geographic-validation-authorization.interface.ts` for the contract.
 */

export const NO_GEOGRAPHIC_GRANT: WorkUnitGeographicGrant = { kind: 'NONE' };

export const DEFAULT_GEOGRAPHIC_AUTHORIZATION: GeographicValidationAuthorization =
  { kind: 'DEFAULT' };

/** A real, open `intent:walk` / `intent:route_like` preference-facet deficit. */
export function isGeographicIntentDeficit(
  deficit: AcquisitionDeficit,
): deficit is GeographicIntentDeficit {
  return (
    deficit.origin === 'preference_facet' &&
    deficit.dimension === 'intent' &&
    (deficit.key === 'walk' || deficit.key === 'route_like')
  );
}

/** The grant of a work unit that exclusively owns `deficit`. */
export function ownedIntentGrant(
  workUnit: GeographicGrantingWorkUnitKind,
  deficit: GeographicIntentDeficit,
): OwnedIntentGeographicGrant {
  return deficit.key === 'walk'
    ? {
        kind: 'OWNED_INTENT',
        intent: 'walk',
        ownedDeficit: { ...deficit, key: 'walk' },
        workUnit,
      }
    : {
        kind: 'OWNED_INTENT',
        intent: 'route_like',
        ownedDeficit: { ...deficit, key: 'route_like' },
        workUnit,
      };
}

/**
 * The authorization of ONE candidate produced by the work unit holding
 * `grant`. Inputs are only the owning grant and the canonical shape
 * predicate: the candidate's `intents`, name and hint roles are never read,
 * and no other open deficit is consulted.
 */
export function authorizeCandidate(
  grant: WorkUnitGeographicGrant,
  candidate: ExperienceCandidate,
): GeographicValidationAuthorization {
  if (grant.kind === 'NONE') return DEFAULT_GEOGRAPHIC_AUTHORIZATION;
  if (
    !candidateSatisfiesEvidenceRequirement(
      candidate,
      'MULTI_COMPONENT_EXPERIENCE',
    )
  ) {
    return DEFAULT_GEOGRAPHIC_AUTHORIZATION;
  }
  return grant.intent === 'walk'
    ? {
        kind: 'WALK',
        authorizedBy: grant,
        admittedAs: 'MULTI_COMPONENT_EXPERIENCE',
      }
    : {
        kind: 'ROUTE_LIKE',
        authorizedBy: grant,
        admittedAs: 'MULTI_COMPONENT_EXPERIENCE',
      };
}

export function authorizeCandidates(
  grant: WorkUnitGeographicGrant,
  candidates: ReadonlyArray<ExperienceCandidate>,
): AuthorizedExperienceCandidate[] {
  return candidates.map((candidate) => ({
    candidate,
    geographicAuthorization: authorizeCandidate(grant, candidate),
  }));
}

/** Pairs candidates of a context that owns no policy deficit. */
export function withDefaultGeographicAuthorization(
  candidates: ReadonlyArray<ExperienceCandidate>,
): AuthorizedExperienceCandidate[] {
  return authorizeCandidates(NO_GEOGRAPHIC_GRANT, candidates);
}

/** Route-scale destination compatibility / thresholds. */
export function authorizesRouteScale(
  authorization: GeographicValidationAuthorization,
): boolean {
  return authorization.kind === 'ROUTE_LIKE';
}

/**
 * Anchored (walk/route) membership in an external AREA scope instead of
 * strict containment.
 */
export function authorizesAnchoredAreaMembership(
  authorization: GeographicValidationAuthorization,
): boolean {
  return authorization.kind === 'WALK' || authorization.kind === 'ROUTE_LIKE';
}

/**
 * Bounded trace projection (trace field `geographicPolicy`): kind + owning
 * work unit + owned intent/deficit + admitted shape. Non-secret domain state.
 */
export function projectGeographicPolicy(
  authorization: GeographicValidationAuthorization,
): {
  kind: GeographicValidationAuthorization['kind'];
  workUnit?: GeographicGrantingWorkUnitKind;
  ownedIntent?: GeographicPolicyIntent;
  ownedDeficit?: string;
  admittedAs?: 'MULTI_COMPONENT_EXPERIENCE';
} {
  if (authorization.kind === 'DEFAULT') return { kind: 'DEFAULT' };
  return {
    kind: authorization.kind,
    workUnit: authorization.authorizedBy.workUnit,
    ownedIntent: authorization.authorizedBy.intent,
    ownedDeficit: `intent:${authorization.authorizedBy.ownedDeficit.key}`,
    admittedAs: authorization.admittedAs,
  };
}
