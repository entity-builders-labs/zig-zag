import { ExperienceCandidate } from './experience-discovery.interface';
import { PreferenceFacetDeficit } from './experience-acquisition-plan.interface';

/**
 * Geographic validation authorization (architecture contract:
 * docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md).
 *
 * A wider geographic policy than the destination default is granted ONLY by
 * the acquisition work unit that exclusively owns one open walk/route_like
 * deficit, and only to the candidates that unit admitted as
 * MULTI_COMPONENT_EXPERIENCE. It is never a property of the tour request
 * (a tour legitimately asks for several intents at once), never inferred
 * from a candidate's own `intents`/name/hint roles, and never borrowed from
 * a deficit owned by another work unit.
 */

/** Intents whose geographic policy differs from the destination default. */
export type GeographicPolicyIntent = 'walk' | 'route_like';

/**
 * An OPEN requested deficit for a policy-bearing intent. Narrowed once, by
 * the acquisition work-unit partition; never constructed from facets,
 * candidates or extractor output.
 */
export interface GeographicIntentDeficit extends PreferenceFacetDeficit {
  dimension: 'intent';
  key: GeographicPolicyIntent;
}

/** The only work-unit kinds that can own a policy-bearing deficit. */
export type GeographicGrantingWorkUnitKind =
  | 'AREA_ROUTE_WALK'
  | 'DEDICATED_INTENT';

export interface OwnedIntentGrantOf<I extends GeographicPolicyIntent> {
  kind: 'OWNED_INTENT';
  intent: I;
  ownedDeficit: GeographicIntentDeficit & { key: I };
  workUnit: GeographicGrantingWorkUnitKind;
}

/** The grant of a work unit that exclusively owns one policy deficit. */
export type OwnedIntentGeographicGrant =
  | OwnedIntentGrantOf<'walk'>
  | OwnedIntentGrantOf<'route_like'>;

/** What one acquisition work unit may grant to its own candidates. */
export type WorkUnitGeographicGrant =
  | { kind: 'NONE' }
  | OwnedIntentGeographicGrant;

/**
 * The geographic policy ONE candidate is validated under. The non-default
 * variants cannot exist without the owning grant (provenance) and the
 * admitted multi-component shape that justified it.
 */
export type GeographicValidationAuthorization =
  | { kind: 'DEFAULT' }
  | {
      kind: 'WALK';
      authorizedBy: OwnedIntentGrantOf<'walk'>;
      admittedAs: 'MULTI_COMPONENT_EXPERIENCE';
    }
  | {
      kind: 'ROUTE_LIKE';
      authorizedBy: OwnedIntentGrantOf<'route_like'>;
      admittedAs: 'MULTI_COMPONENT_EXPERIENCE';
    };

/**
 * A candidate paired with its authorization before resolution begins, so a
 * heterogeneous batch can never share one batch-level policy.
 */
export interface AuthorizedExperienceCandidate {
  candidate: ExperienceCandidate;
  geographicAuthorization: GeographicValidationAuthorization;
}
