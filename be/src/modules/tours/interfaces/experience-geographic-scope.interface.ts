import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { Coordinates } from '@shared/utils/distance.utils';

/**
 * Experience geographic scope — spec
 * `docs/superpowers/specs/2026-10-02-geographic-validation-authorization-review.md`
 * Part II (§P2-6 / §P2-7).
 *
 * Four questions stay separate and each has one owner:
 *  - AUTHORIZATION (`GeographicValidationAuthorization`): which policy
 *    class a candidate may use. Never a geometry, center or radius.
 *  - EXPERIENCE SCOPE (this file, derived by
 *    `deriveExperienceGeographicScope`): the real geometry the Experience
 *    physically belongs to.
 *  - DESTINATION RELATION (`ExperienceDestinationRelation`): a per-request
 *    FACT about the Experience vs the trip destination — never a validity
 *    gate for a verified regional scope, never persisted as catalog truth.
 *  - SEARCH WINDOW (`ScopeSearchWindow`): the provider search geography,
 *    derived from the scope's real geometry — never a plausibility radius.
 */

/** Who established an Experience scope (§P2-6 S-a…S-e). */
export type ExperienceGeographicScopeProvenance =
  /** S-a: the user-named anchor of the producing work unit. */
  | 'WORK_UNIT_ANCHOR'
  /** S-b: a source-backed `area`-role component resolved to a canonical AREA. */
  | 'CANDIDATE_AREA'
  /** S-c: a resolved canonical physical ROUTE component. */
  | 'CANDIDATE_ROUTE'
  /** S-d: the trip destination's administrative polygon. */
  | 'DESTINATION_AREA'
  /** S-e: the trip destination's explicit point-radius scope. */
  | 'DESTINATION_POINT_RADIUS';

/**
 * Why no Experience scope could be established (§P2-7, PD2). Every reason
 * fails closed with `GEOGRAPHIC_SCOPE_UNKNOWN`; none manufactures a region.
 */
export type GeographicScopeUnknownReason =
  /** Components lie beyond the destination and the candidate owns no verified scope. */
  | 'NO_VERIFIED_SCOPE_FOR_COMPONENTS_BEYOND_DESTINATION'
  /** A candidate-owned scope lies beyond the destination and the authorization does not admit it. */
  | 'SCOPE_BEYOND_DESTINATION_NOT_AUTHORIZED'
  /** Two or more candidate-owned scopes and the composition is not destination-local. */
  | 'MULTIPLE_CANDIDATE_SCOPES'
  /** The destination has no usable geography to relate the candidate to. */
  | 'DESTINATION_GEOGRAPHY_UNKNOWN';

export type ExperienceGeographicScope =
  | {
      kind: 'AREA';
      provenance: 'WORK_UNIT_ANCHOR' | 'CANDIDATE_AREA' | 'DESTINATION_AREA';
      name?: string;
      geoEntityId?: string;
      /** Real Polygon/MultiPolygon. */
      geometry: GeoJsonGeometry;
    }
  | {
      kind: 'ROUTE';
      provenance: 'WORK_UNIT_ANCHOR' | 'CANDIDATE_ROUTE';
      name?: string;
      geoEntityId?: string;
      /** Real LineString/MultiLineString. */
      geometry: GeoJsonGeometry;
    }
  | {
      kind: 'POINT_RADIUS';
      provenance: 'DESTINATION_POINT_RADIUS';
      name?: string;
      center: Coordinates;
      /** The scope's own radius (a request/anchor input), never a policy threshold. */
      radiusMeters: number;
    }
  | {
      kind: 'UNKNOWN';
      reason: GeographicScopeUnknownReason;
    };

export type KnownExperienceGeographicScope = Exclude<
  ExperienceGeographicScope,
  { kind: 'UNKNOWN' }
>;

/**
 * The user-named work-unit anchor scope (S-a) threaded on a resolution
 * request (`ExperienceResolutionRequest.validationScope`). Its provenance is
 * the field it travels on: it is always `WORK_UNIT_ANCHOR` and is a
 * constraint every candidate of that unit must satisfy IN CONJUNCTION with
 * the candidate's own scope — never replaced by it.
 *
 * `geometry` is required — `AreaRouteAnchorResolverService`'s
 * `resolved: true` contract guarantees it; a caller that somehow constructs
 * one without usable geometry gets a conservative rejection (fail closed).
 */
export interface WorkUnitAnchorScope {
  kind: 'AREA' | 'ROUTE';
  anchorName: string;
  geoEntityId: string;
  geometry: GeoJsonGeometry;
}

/**
 * Relation of a candidate-owned scope geometry to the trip destination
 * (§P2-7: recorded as a fact; only the authorization × relation table of
 * §P2-6 decides admissibility).
 */
export type ScopeDestinationRelation =
  | 'INSIDE'
  | 'INTERSECTS'
  | 'OUTSIDE'
  | 'UNKNOWN';

/**
 * Relation of an Experience's components to the trip destination (§P2-9).
 * Produced by geographic validation, consumed by tour eligibility/planning.
 * It is trip-relative and therefore never persisted as catalog truth.
 */
export type ExperienceDestinationRelationKind =
  | 'WITHIN_DESTINATION'
  | 'EXTENDS_BEYOND_DESTINATION'
  | 'OUTSIDE_DESTINATION'
  | 'UNKNOWN';

export interface ExperienceDestinationRelation {
  relation: ExperienceDestinationRelationKind;
  /** Component hint keys positively outside the destination. */
  outsideComponentKeys: string[];
  /** Component hint keys whose relation could not be computed. */
  undeterminedComponentKeys: string[];
}

/**
 * A provider search window derived from real scope geometry: the smallest
 * center + radius covering the scope's bounding box (the existing
 * `boundingBoxToCenterRadius` physical derivation), or the scope's own
 * point radius. It answers "where may providers look?", never "is this
 * plausible?": membership is still decided by the scope geometry itself.
 * Provider operational caps (bias vs restriction, maximum radius) stay
 * inside the provider adapters.
 */
export interface ScopeSearchWindow {
  provenance: ExperienceGeographicScopeProvenance;
  center: Coordinates;
  radiusMeters: number;
}

/** Bounded trace projection of a scope (no raw geometry). */
export interface ExperienceGeographicScopeProjection {
  kind: ExperienceGeographicScope['kind'];
  provenance?: ExperienceGeographicScopeProvenance;
  name?: string;
  geoEntityId?: string;
  unknownReason?: GeographicScopeUnknownReason;
  /** Relation of a candidate-owned scope to the destination. */
  destinationRelation?: ScopeDestinationRelation;
}
