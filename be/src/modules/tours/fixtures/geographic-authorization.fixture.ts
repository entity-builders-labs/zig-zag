import {
  GeographicGrantingWorkUnitKind,
  GeographicIntentDeficit,
  GeographicPolicyIntent,
  GeographicValidationAuthorization,
} from '../interfaces/geographic-validation-authorization.interface';
import { ownedIntentGrant } from '../utils/geographic-validation-authorization.util';

/**
 * Test fixtures for geographic validation authorization. Built from the
 * production grant constructor so fixtures carry the same provenance a
 * real owning work unit would.
 */
export function geographicIntentDeficit(
  intent: GeographicPolicyIntent,
): GeographicIntentDeficit {
  return {
    origin: 'preference_facet',
    dimension: 'intent',
    key: intent,
    reason: `Preference facet [intent:${intent}] has no strong catalog match yet.`,
  };
}

/** The authorization an owning unit grants a multi-component candidate. */
export function ownedAuthorization(
  intent: GeographicPolicyIntent,
  workUnit: GeographicGrantingWorkUnitKind = 'DEDICATED_INTENT',
): GeographicValidationAuthorization {
  const grant = ownedIntentGrant(workUnit, geographicIntentDeficit(intent));
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
