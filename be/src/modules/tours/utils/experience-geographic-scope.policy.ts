import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { Coordinates } from '@shared/utils/distance.utils';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import {
  GeographicScope,
  ResolvedGeoEntity,
} from '../interfaces/experience-resolution.interface';
import {
  ExperienceGeographicScope,
  ExperienceGeographicScopeProjection,
  KnownExperienceGeographicScope,
  ScopeDestinationRelation,
  ScopeMembershipSemantics,
  ScopeSearchWindow,
  WorkUnitAnchorScope,
} from '../interfaces/experience-geographic-scope.interface';
import { GeographicValidationAuthorization } from '../interfaces/geographic-validation-authorization.interface';
import { classifyComponentAreaRelation } from './area-scope-membership-policy';
import {
  DestinationCompatibility,
  evaluateDestinationCompatibility,
  evaluateScopeDestinationRelation,
} from './destination-compatibility.policy';
import { boundingBoxToCenterRadius } from './geometry-search-area.util';
import { isUsableRouteGeometry } from './route-geometry.util';

/**
 * THE single owner of Experience geographic scope derivation (spec
 * 2026-10-02 Part II §P2-6 / §P2-7). Both component acquisition (phase 2 of
 * the resolver's two-phase resolution) and composite geographic validation
 * call `deriveExperienceGeographicScope`, so the scope that bounds a
 * component's identity search is, by construction, the scope that later
 * judges it.
 *
 * Inputs are only: the candidate's source-backed hint roles, the RESOLVED
 * canonical scope components (AREA polygon / physical ROUTE line), the
 * candidate's work-unit authorization and the trip destination. Never the
 * candidate name, `candidate.intents`, component count or a distance.
 *
 * Authorization selects which REAL scopes are admissible; it never creates
 * one: ROUTE_LIKE is the only class that may use a candidate-owned scope
 * lying beyond the destination (§P2-6 table). WALK never borrows that.
 *
 * §P2-18: a derived scope is either a STRICT constraint or DESCRIPTIVE
 * source context (`scopeMembershipSemantics`), and the absence of an
 * enclosing canonical scope is not UNKNOWN for a ROUTE_LIKE candidate: the
 * destination scope is returned and composite validation judges members
 * beyond it on their source-defined component geography.
 */

/**
 * Canonical physical ROUTE authority: a RESOLVED component whose canonical
 * GeoEntity kind is ROUTE and whose geometry is a usable route line. The
 * source hint role must also be `route` (source-composition correspondence),
 * but the role alone never establishes route reality: a `route`-role hint
 * resolved to a PLACE, or without usable route geometry, fails closed.
 */
export function isCanonicalPhysicalRouteComponent(
  entity: ResolvedGeoEntity,
): boolean {
  return (
    entity.role === 'route' &&
    entity.status === 'resolved' &&
    entity.kind === 'ROUTE' &&
    isUsableRouteGeometry(entity.geometry)
  );
}

function isPolygonal(geometry: unknown): geometry is GeoJsonGeometry {
  const type = (geometry as { type?: unknown } | null | undefined)?.type;
  return type === 'Polygon' || type === 'MultiPolygon';
}

/**
 * A resolved, source-backed `area`-role component with real polygon
 * geometry. The role must match the source hint; the canonical kind (when
 * known) must be AREA — a role alone never creates an area.
 */
function isCanonicalAreaScopeComponent(entity: ResolvedGeoEntity): boolean {
  return (
    entity.role === 'area' &&
    entity.status === 'resolved' &&
    (entity.kind === undefined || entity.kind === 'AREA') &&
    isPolygonal(entity.geometry)
  );
}

export interface DerivedExperienceGeographicScope {
  scope: ExperienceGeographicScope;
  /** Relation of a candidate-owned scope to the destination (a fact). */
  ownedScopeDestinationRelation?: ScopeDestinationRelation;
}

function destinationExperienceScope(
  destination: GeographicScope | undefined,
): ExperienceGeographicScope {
  if (destination?.kind === 'POINT_RADIUS') {
    return {
      kind: 'POINT_RADIUS',
      provenance: 'DESTINATION_POINT_RADIUS',
      center: {
        latitude: destination.latitude,
        longitude: destination.longitude,
      },
      radiusMeters: destination.radiusMeters,
    };
  }
  if (
    destination?.kind === 'AREA_BOUNDARY' &&
    isPolygonal(destination.boundary?.geometry)
  ) {
    return {
      kind: 'AREA',
      provenance: 'DESTINATION_AREA',
      ...(destination.boundary.name ? { name: destination.boundary.name } : {}),
      geometry: destination.boundary.geometry,
    };
  }
  return { kind: 'UNKNOWN', reason: 'DESTINATION_GEOGRAPHY_UNKNOWN' };
}

export function deriveExperienceGeographicScope(input: {
  candidate: Pick<ExperienceCandidate, 'componentHints'>;
  /** Resolved entities so far (phase 1: scope components only). */
  resolvedEntities: ResolvedGeoEntity[];
  authorization: GeographicValidationAuthorization;
  destination: GeographicScope | undefined;
  /** S-a: the producing work unit's user-named anchor, when any. */
  workUnitScope?: WorkUnitAnchorScope;
}): DerivedExperienceGeographicScope {
  const hints = input.candidate.componentHints ?? [];
  const routeLike = input.authorization.kind === 'ROUTE_LIKE';
  const resolved = input.resolvedEntities.filter(
    (entity) => entity.status === 'resolved',
  );

  const routes = resolved.filter(isCanonicalPhysicalRouteComponent);
  const areaHints = hints.filter((hint) => hint.role === 'area');
  const hasMemberHint = hints.some(
    (hint) => hint.role === 'waypoint' || hint.role === 'venue',
  );
  const owned: ResolvedGeoEntity | undefined =
    routes.length === 1
      ? routes[0]
      : routes.length === 0 && areaHints.length === 1 && hasMemberHint
        ? resolved.find(
            (entity) =>
              entity.hintKey === areaHints[0].key &&
              isCanonicalAreaScopeComponent(entity),
          )
        : undefined;
  // Two or more candidate-owned scopes give no single Experience scope:
  // they stay descriptive context of the composition and the destination
  // scope judges it (a ROUTE_LIKE member beyond it is source-defined).
  const multipleOwned =
    routes.length > 1 || (routes.length === 0 && areaHints.length > 1);

  if (owned) {
    const role = owned.role === 'route' ? 'route' : 'area';
    const geometry = owned.geometry as GeoJsonGeometry;
    const relation = evaluateScopeDestinationRelation(
      geometry,
      role,
      input.destination,
    );
    const admissible =
      routeLike || relation === 'INSIDE' || relation === 'INTERSECTS';
    if (admissible) {
      const common = {
        ...(owned.canonicalName || owned.hintName
          ? { name: owned.canonicalName ?? owned.hintName }
          : {}),
        ...(owned.geoEntityId ? { geoEntityId: owned.geoEntityId } : {}),
        geometry,
      };
      return {
        scope:
          role === 'route'
            ? { kind: 'ROUTE', provenance: 'CANDIDATE_ROUTE', ...common }
            : { kind: 'AREA', provenance: 'CANDIDATE_AREA', ...common },
        ownedScopeDestinationRelation: relation,
      };
    }
    if (relation === 'OUTSIDE') {
      return {
        scope: {
          kind: 'UNKNOWN',
          reason: 'SCOPE_BEYOND_DESTINATION_NOT_AUTHORIZED',
        },
        ownedScopeDestinationRelation: relation,
      };
    }
    // Relation UNKNOWN (e.g. a point-radius destination cannot relate a
    // polygon honestly) and no ROUTE_LIKE authorization: the owned scope is
    // not admissible as a widening; the destination scope judges instead.
  }

  // S-a as the Experience scope: only for a user-named AREA anchor that
  // reaches beyond the destination (the destination then cannot judge the
  // components), and only under ROUTE_LIKE — WALK never borrows a
  // beyond-destination scope. An anchor inside the destination stays a
  // conjunctive constraint (checked separately) over the destination scope.
  if (
    !multipleOwned &&
    input.workUnitScope?.kind === 'AREA' &&
    isPolygonal(input.workUnitScope.geometry)
  ) {
    const relation = evaluateScopeDestinationRelation(
      input.workUnitScope.geometry,
      'area',
      input.destination,
    );
    if (relation === 'OUTSIDE') {
      return routeLike
        ? {
            scope: {
              kind: 'AREA',
              provenance: 'WORK_UNIT_ANCHOR',
              name: input.workUnitScope.anchorName,
              geoEntityId: input.workUnitScope.geoEntityId,
              geometry: input.workUnitScope.geometry,
            },
            ownedScopeDestinationRelation: relation,
          }
        : {
            scope: {
              kind: 'UNKNOWN',
              reason: 'SCOPE_BEYOND_DESTINATION_NOT_AUTHORIZED',
            },
            ownedScopeDestinationRelation: relation,
          };
    }
  }

  return { scope: destinationExperienceScope(input.destination) };
}

/**
 * §P2-18: may this candidate's composition extend beyond the trip
 * destination without an enclosing canonical scope? Only a ROUTE_LIKE
 * authorization (Part I: the one policy class whose owning work unit was
 * granted a wider geography) and only when no STRICT user anchor bounds the
 * work unit — an anchor is the request's own geography and is never
 * bypassed by a source-defined extension. The single owner for both
 * component acquisition (country-bounded admission) and validation.
 */
export function mayExtendBeyondDestination(
  authorization: GeographicValidationAuthorization,
  workUnitScope: WorkUnitAnchorScope | undefined,
): boolean {
  return authorization.kind === 'ROUTE_LIKE' && !workUnitScope;
}

/**
 * §P2-18: what a known scope's geometry means for membership. Decided only
 * by who established it (and, for the destination, by whether the candidate
 * may extend beyond it) — never by a distance, a category, a title or the
 * mere presence of an AREA hint.
 *  - WORK_UNIT_ANCHOR: STRICT — the user named it as the geography of the
 *    walk/route_like need its work unit exclusively owns.
 *  - CANDIDATE_AREA / CANDIDATE_ROUTE: DESCRIPTIVE — the source's own
 *    geographic description of its composition.
 *  - DESTINATION_*: STRICT unless `mayExtendBeyondDestination` (DEFAULT/WALK
 *    authorization ceiling, or a strict anchor's unit); DESCRIPTIVE for a
 *    ROUTE_LIKE source-defined composition.
 */
export function scopeMembershipSemantics(
  scope: KnownExperienceGeographicScope,
  extendsBeyondDestination: boolean,
): ScopeMembershipSemantics {
  switch (scope.provenance) {
    case 'WORK_UNIT_ANCHOR':
      return 'STRICT';
    case 'CANDIDATE_AREA':
    case 'CANDIDATE_ROUTE':
      return 'DESCRIPTIVE';
    case 'DESTINATION_AREA':
    case 'DESTINATION_POINT_RADIUS':
      return extendsBeyondDestination ? 'DESCRIPTIVE' : 'STRICT';
  }
}

/**
 * The provider search window of a known scope: the bounding-box covering
 * circle of its real geometry (a physical derivation), or its own point
 * radius. UNKNOWN has no window.
 */
export function scopeSearchWindow(
  scope: ExperienceGeographicScope,
): ScopeSearchWindow | undefined {
  if (scope.kind === 'UNKNOWN' || scope.kind === 'SOURCE_DEFINED_COMPONENTS') {
    return undefined;
  }
  if (scope.kind === 'POINT_RADIUS') {
    return {
      provenance: scope.provenance,
      center: scope.center,
      radiusMeters: scope.radiusMeters,
    };
  }
  const circle = boundingBoxToCenterRadius(scope.geometry);
  if (
    !Number.isFinite(circle.latitude) ||
    !Number.isFinite(circle.longitude) ||
    !Number.isFinite(circle.radiusMeters)
  ) {
    return undefined;
  }
  return {
    provenance: scope.provenance,
    center: { latitude: circle.latitude, longitude: circle.longitude },
    radiusMeters: Math.ceil(circle.radiusMeters),
  };
}

/**
 * The search window of a request `GeographicScope` (destination or the
 * work-unit entity-resolution pool scope), with the provenance it acts under.
 */
export function geographicScopeSearchWindow(
  scope: GeographicScope,
  provenance: ScopeSearchWindow['provenance'],
): ScopeSearchWindow | undefined {
  if (scope.kind === 'POINT_RADIUS') {
    return {
      provenance,
      center: { latitude: scope.latitude, longitude: scope.longitude },
      radiusMeters: scope.radiusMeters,
    };
  }
  if (!isPolygonal(scope.boundary?.geometry)) return undefined;
  const window = scopeSearchWindow({
    kind: 'AREA',
    provenance: 'DESTINATION_AREA',
    geometry: scope.boundary.geometry,
  });
  return window ? { ...window, provenance } : undefined;
}

export function projectExperienceGeographicScope(
  derived: DerivedExperienceGeographicScope,
  membership?: {
    semantics: ScopeMembershipSemantics;
    outsideScopeComponentKeys?: string[];
  },
): ExperienceGeographicScopeProjection {
  const { scope } = derived;
  if (scope.kind === 'UNKNOWN') {
    return {
      kind: 'UNKNOWN',
      unknownReason: scope.reason,
      ...(derived.ownedScopeDestinationRelation
        ? { destinationRelation: derived.ownedScopeDestinationRelation }
        : {}),
    };
  }
  if (scope.kind === 'SOURCE_DEFINED_COMPONENTS') {
    return {
      kind: scope.kind,
      provenance: scope.provenance,
      membership: 'DESCRIPTIVE',
      supportingEvidenceKeys: [...scope.supportingEvidenceKeys],
    };
  }
  return {
    kind: scope.kind,
    provenance: scope.provenance,
    ...(scope.name ? { name: scope.name } : {}),
    ...('geoEntityId' in scope && scope.geoEntityId
      ? { geoEntityId: scope.geoEntityId }
      : {}),
    ...(derived.ownedScopeDestinationRelation
      ? { destinationRelation: derived.ownedScopeDestinationRelation }
      : {}),
    ...(membership ? { membership: membership.semantics } : {}),
    ...(membership?.outsideScopeComponentKeys?.length
      ? { outsideScopeComponentKeys: [...membership.outsideScopeComponentKeys] }
      : {}),
  };
}

/**
 * Admission of a provider location for the component search scope. Flat
 * (not a discriminated union): this repo compiles without strictNullChecks,
 * under which union narrowing is unreliable.
 */
export interface ComponentLocationAdmission {
  admitted: boolean;
  /** Present when not admitted. */
  reason?: 'DESTINATION_INCOMPATIBLE' | 'OUTSIDE_EXPERIENCE_SCOPE';
  /** Present when `reason` is DESTINATION_INCOMPATIBLE. */
  destinationCompatibility?: DestinationCompatibility;
}

/**
 * Acquisition-time admission of a provider location for a component of a
 * candidate whose scope is `scope` — consistent with how composite
 * validation will judge it (§P2-10 as amended by §P2-18):
 *  - a STRICT regional WORK_UNIT_ANCHOR AREA acting as the Experience scope:
 *    the point must lie inside that polygon;
 *  - a DESCRIPTIVE CANDIDATE_AREA: inside the AREA is admitted; outside it
 *    the location is judged like any other scope's, below (an AREA the
 *    source names never becomes a containment boundary);
 *  - every scope: the destination policy (a point can never be topologically
 *    ON a route line, so a CANDIDATE_ROUTE admits what the destination
 *    admits; S-a anchors are validated afterwards, in conjunction);
 *  - a location the destination positively excludes is still admitted when
 *    the provider query itself was bounded to the destination COUNTRY (a
 *    real authority, enforced provider-side) and the candidate may extend
 *    beyond the destination (`mayExtendBeyondDestination`: ROUTE_LIKE, no
 *    strict work-unit anchor). Identity is then decided by
 *    `IdentityVerifier` over that country-bounded result set — never by
 *    proximity, never by being the first hit.
 * UNKNOWN destination compatibility excludes nothing (unchanged).
 */
export function admitComponentLocation(
  scope: KnownExperienceGeographicScope,
  location: Coordinates | undefined,
  destination: GeographicScope | undefined,
  provider: { countryBounded: boolean } = { countryBounded: false },
): ComponentLocationAdmission {
  const finite =
    !!location &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude);
  if (scope.kind === 'AREA' && scope.provenance !== 'DESTINATION_AREA') {
    const inside =
      finite &&
      classifyComponentAreaRelation(scope.geometry, {
        role: 'venue',
        latitude: location.latitude,
        longitude: location.longitude,
      }).relation === 'INSIDE';
    if (inside) return { admitted: true };
    if (scope.provenance === 'WORK_UNIT_ANCHOR') {
      return { admitted: false, reason: 'OUTSIDE_EXPERIENCE_SCOPE' };
    }
  }
  const destinationCompatibility = evaluateDestinationCompatibility(
    { probePoints: location ? [location] : [] },
    destination,
  );
  if (destinationCompatibility.verdict !== 'INCOMPATIBLE') {
    return { admitted: true };
  }
  if (provider.countryBounded && finite) return { admitted: true };
  return {
    admitted: false,
    reason: 'DESTINATION_INCOMPATIBLE',
    destinationCompatibility,
  };
}
