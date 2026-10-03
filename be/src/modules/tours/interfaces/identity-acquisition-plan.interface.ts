import { GeoEntityKind } from '@prisma/client';
import { GeographicValidationAuthorization } from './geographic-validation-authorization.interface';

/**
 * The component-resolution owner's explicit permission to acquire identity
 * facts. This is deliberately separate from ExperienceAcquisitionPlan:
 * that plan owns discovery-source acquisition, while this one owns a single
 * physical component's identity lookup.
 */
export type IdentityAcquisitionStrategy =
  | 'NOMINATIM'
  | 'PLACES'
  | 'OVERTURE_IDENTITY';

export interface IdentityAcquisitionPlan {
  hintKey: string;
  expectedKind: GeoEntityKind;
  /** The authorization already established for the producing work unit. */
  geographicAuthorization: GeographicValidationAuthorization;
  /** Grounded country context; Overture never runs as a worldwide lookup. */
  countryCode?: string;
  strategies: readonly IdentityAcquisitionStrategy[];
}

/**
 * Canonical plan construction at the component-resolution boundary. Provider
 * failures and candidate names are intentionally absent from this input: they
 * cannot authorize another strategy.
 */
export function buildIdentityAcquisitionPlan(input: {
  hintKey: string;
  expectedKind: GeoEntityKind;
  geographicAuthorization: GeographicValidationAuthorization;
  externalAcquisitionAuthorized: boolean;
  countryCode?: string;
}): IdentityAcquisitionPlan {
  if (!input.externalAcquisitionAuthorized) {
    return {
      hintKey: input.hintKey,
      expectedKind: input.expectedKind,
      geographicAuthorization: input.geographicAuthorization,
      countryCode: input.countryCode,
      strategies: [],
    };
  }

  const strategies: IdentityAcquisitionStrategy[] = ['NOMINATIM'];
  if (input.expectedKind === GeoEntityKind.PLACE) {
    strategies.push('PLACES');
    // A country is an independently established operational bound, not a
    // substitute for Experience geography or identity evidence.
    if (input.countryCode) strategies.push('OVERTURE_IDENTITY');
  }
  return {
    hintKey: input.hintKey,
    expectedKind: input.expectedKind,
    geographicAuthorization: input.geographicAuthorization,
    countryCode: input.countryCode,
    strategies,
  };
}

export function authorizesIdentityStrategy(
  plan: IdentityAcquisitionPlan,
  strategy: IdentityAcquisitionStrategy,
): boolean {
  return plan.strategies.includes(strategy);
}
