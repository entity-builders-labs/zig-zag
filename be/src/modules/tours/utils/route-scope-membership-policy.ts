import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';
import { ComponentGeometryBasis } from '../interfaces/area-scope-membership.interface';
import {
  ComponentRouteRelationFact,
  RouteScopeComponentFact,
  RouteScopeMembershipDecision,
} from '../interfaces/route-scope-membership.interface';
import { distancePointToLineStringMeters } from './route-geometry.util';
import { normalizeGeoName } from './nominatim-match.util';
import { evaluateDestinationCompatibility } from './destination-compatibility.policy';
import { classifyComponentAreaRelation } from './area-scope-membership-policy';

type RouteGeometry = Extract<
  GeoJsonGeometry,
  { type: 'LineString' | 'MultiLineString' }
>;

type AreaGeometry = Extract<
  GeoJsonGeometry,
  { type: 'Polygon' | 'MultiPolygon' }
>;

function isRouteGeometry(geometry: unknown): geometry is RouteGeometry {
  if (!geometry || typeof geometry !== 'object') return false;
  const g = geometry as GeoJsonGeometry;
  if (g.type !== 'LineString' && g.type !== 'MultiLineString') return false;
  if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) return false;
  if (g.type === 'LineString') {
    return g.coordinates.length >= 2;
  }
  return g.coordinates.some((line) => Array.isArray(line) && line.length >= 2);
}

function isAreaGeometry(geometry: unknown): geometry is AreaGeometry {
  if (!geometry || typeof geometry !== 'object') return false;
  const g = geometry as GeoJsonGeometry;
  return g.type === 'Polygon' || g.type === 'MultiPolygon';
}

function geometryBasis(
  component: RouteScopeComponentFact,
): ComponentGeometryBasis {
  if (isRouteGeometry(component.geometry)) return 'LINE';
  if (isAreaGeometry(component.geometry)) return 'POLYGON';
  if (
    Number.isFinite(component.latitude) &&
    Number.isFinite(component.longitude)
  ) {
    return 'POINT';
  }
  return 'NONE';
}

function isAnchorComponent(
  component: RouteScopeComponentFact,
  routeScope: {
    anchorName: string;
    geoEntityId?: string;
  },
): boolean {
  if (
    component.geoEntityId &&
    routeScope.geoEntityId &&
    component.geoEntityId === routeScope.geoEntityId
  ) {
    return true;
  }
  const normalizedAnchor = normalizeGeoName(routeScope.anchorName);
  if (
    component.hintName &&
    normalizeGeoName(component.hintName) === normalizedAnchor
  ) {
    return true;
  }
  if (
    component.canonicalName &&
    normalizeGeoName(component.canonicalName) === normalizedAnchor
  ) {
    return true;
  }
  return false;
}

/**
 * Pure policy evaluating the geographic coherence of a source-backed Experience
 * with a mandatory ROUTE anchor.
 *
 * Invariants:
 * 1. The anchor itself must be represented by real canonical geography and remain
 *    required by the request.
 * 2. The Experience must have a material relationship to that anchor (at least one
 *    component is ANCHOR_COMPONENT or physically ON_ROUTE).
 * 3. Additional source-backed components may extend beyond the literal route
 *    geometry if they remain geographically coherent with the anchor context
 *    (e.g. within the destination and sharing local scope).
 * 4. Destination compatibility remains mandatory.
 * 5. Distance is evidence/diagnostic for observability (Bitácora), NEVER an arbitrary
 *    semantic cutoff for validity.
 * 6. Walking feasibility belongs strictly to the planner.
 */
export function evaluateRouteScopeMembership(
  routeScope: {
    anchorName: string;
    geoEntityId?: string;
    geometry: GeoJsonGeometry;
  },
  components: RouteScopeComponentFact[],
  destinationBoundary?: OsmCandidate,
): RouteScopeMembershipDecision {
  if (!isRouteGeometry(routeScope.geometry) || components.length === 0) {
    return {
      passes: false,
      hasAnchorSatisfaction: false,
      hasDestinationMismatch: false,
      rejectionReason: 'EXTERNAL_ROUTE_SCOPE_MISMATCH',
      components: components.map((c) => ({
        ...(c.hintKey ? { hintKey: c.hintKey } : {}),
        role: c.role,
        basis: geometryBasis(c),
        relation: 'NO_MATERIAL_ANCHOR_RELATION',
      })),
    };
  }

  // Find any enclosing area components in the proposal (e.g. "La Boca" polygon)
  // that cover or intersect the route anchor geometry.
  const enclosingAreaComponents = components.filter(
    (c) => c.role === 'area' && isAreaGeometry(c.geometry),
  );

  const routeComponentFact: RouteScopeComponentFact = {
    role: 'route',
    geometry: routeScope.geometry,
  };

  const sharedEnclosingAreas = enclosingAreaComponents.filter((areaComp) => {
    const areaRel = classifyComponentAreaRelation(
      areaComp.geometry as GeoJsonGeometry,
      routeComponentFact,
    );
    return areaRel.relation === 'INSIDE' || areaRel.relation === 'INTERSECTS';
  });

  const relationFacts: ComponentRouteRelationFact[] = [];

  for (const component of components) {
    const basis = geometryBasis(component);
    const baseFact = {
      ...(component.hintKey ? { hintKey: component.hintKey } : {}),
      role: component.role,
      basis,
    };

    if (basis === 'NONE') {
      relationFacts.push({
        ...baseFact,
        relation: 'NO_MATERIAL_ANCHOR_RELATION',
      });
      continue;
    }

    // 1. Is this component the anchor itself?
    if (isAnchorComponent(component, routeScope)) {
      relationFacts.push({
        ...baseFact,
        relation: 'ANCHOR_COMPONENT',
        distanceFromRouteMeters: 0,
      });
      continue;
    }

    // Compute diagnostic distance to route
    let distanceToRoute: number | undefined;
    if (basis === 'POINT') {
      distanceToRoute = distancePointToLineStringMeters(
        {
          latitude: component.latitude as number,
          longitude: component.longitude as number,
        },
        routeScope.geometry,
      );
    }

    // 2. Check destination compatibility if destination boundary is available
    if (
      destinationBoundary &&
      Number.isFinite(component.latitude) &&
      Number.isFinite(component.longitude)
    ) {
      const destCheck = evaluateDestinationCompatibility(
        {
          probePoints: [
            {
              latitude: component.latitude as number,
              longitude: component.longitude as number,
            },
          ],
        },
        { kind: 'AREA_BOUNDARY', boundary: destinationBoundary },
      );
      if (destCheck.verdict === 'INCOMPATIBLE') {
        relationFacts.push({
          ...baseFact,
          relation: 'OUTSIDE_DESTINATION',
          ...(distanceToRoute !== undefined
            ? { distanceFromRouteMeters: distanceToRoute }
            : {}),
        });
        continue;
      }
    }

    // 3. Is component physically on route (within street-level contact)?
    if (
      distanceToRoute !== undefined &&
      Number.isFinite(distanceToRoute) &&
      distanceToRoute <= 20
    ) {
      relationFacts.push({
        ...baseFact,
        relation: 'ON_ROUTE',
        distanceFromRouteMeters: distanceToRoute,
      });
      continue;
    }

    // 4. Does it share an enclosing area with the route (e.g. La Boca neighborhood)?
    const sharesArea = sharedEnclosingAreas.some((areaComp) => {
      const compAreaRel = classifyComponentAreaRelation(
        areaComp.geometry as GeoJsonGeometry,
        component,
      );
      return (
        compAreaRel.relation === 'INSIDE' ||
        compAreaRel.relation === 'INTERSECTS'
      );
    });

    if (sharesArea) {
      relationFacts.push({
        ...baseFact,
        relation: 'SAME_LOCAL_SCOPE',
        ...(distanceToRoute !== undefined
          ? { distanceFromRouteMeters: distanceToRoute }
          : {}),
      });
      continue;
    }

    // 5. Destination-compatible extension belonging to the source composition
    relationFacts.push({
      ...baseFact,
      relation: 'DESTINATION_COMPATIBLE_EXTENSION',
      ...(distanceToRoute !== undefined
        ? { distanceFromRouteMeters: distanceToRoute }
        : {}),
    });
  }

  const hasAnchorSatisfaction = relationFacts.some(
    (f) => f.relation === 'ANCHOR_COMPONENT' || f.relation === 'ON_ROUTE',
  );

  const hasDestinationMismatch = relationFacts.some(
    (f) => f.relation === 'OUTSIDE_DESTINATION',
  );

  if (!hasAnchorSatisfaction) {
    return {
      passes: false,
      hasAnchorSatisfaction: false,
      hasDestinationMismatch,
      rejectionReason: 'NO_MATERIAL_ANCHOR_RELATION',
      components: relationFacts,
    };
  }

  if (hasDestinationMismatch) {
    return {
      passes: false,
      hasAnchorSatisfaction: true,
      hasDestinationMismatch: true,
      rejectionReason: 'OUTSIDE_DESTINATION_BOUNDARY',
      components: relationFacts,
    };
  }

  return {
    passes: true,
    hasAnchorSatisfaction: true,
    hasDestinationMismatch: false,
    components: relationFacts,
  };
}
