import { GeoEntityKind } from '@prisma/client';
import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import {
  distancePointToPolygonBoundaryMeters,
  geometryContainsPoint,
} from '@integrations/osm/utils/geojson-containment.util';
import {
  AreaScopeComponentFact,
  AreaScopeMembershipDecision,
  AreaScopeMembershipPolicy,
  ComponentAreaRelationFact,
  ComponentGeometryBasis,
} from '../interfaces/area-scope-membership.interface';
import { distanceMeters } from './geographic-coherence.util';

type AreaGeometry = Extract<
  GeoJsonGeometry,
  { type: 'Polygon' | 'MultiPolygon' }
>;
type Position = [number, number] | number[];

/**
 * Canonical area membership semantics shared by acquisition validation,
 * component resolution coverage and catalog reuse. It is the single
 * authority for how a point, a line and a polygon relate to an AREA.
 *
 * The policy evaluates every component it is given; which components exist
 * is decided by source composition upstream, never by a flag here.
 * Anchored routes need a real route/point relationship with the area; they
 * do not inherit strict containment for every component.
 */
export function evaluateAreaScopeMembership(
  areaGeometry: GeoJsonGeometry | undefined,
  components: AreaScopeComponentFact[],
  policy: AreaScopeMembershipPolicy,
): AreaScopeMembershipDecision {
  if (!isAreaGeometry(areaGeometry) || components.length === 0) {
    return {
      passes: false,
      routeIntersectsArea: false,
      pointComponentInside: false,
      components: components.map((component) => ({
        ...(component.hintKey ? { hintKey: component.hintKey } : {}),
        role: component.role,
        basis: geometryBasis(component),
        relation: 'UNDETERMINED' as const,
      })),
    };
  }

  const relations = components.map((component) =>
    classifyComponentAreaRelation(areaGeometry, component),
  );
  const routeIntersectsArea = relations.some(
    (fact) =>
      fact.basis === 'LINE' &&
      (fact.relation === 'INSIDE' || fact.relation === 'INTERSECTS'),
  );
  const pointComponentInside = relations.some(
    (fact) =>
      fact.role !== 'area' &&
      fact.basis !== 'LINE' &&
      fact.relation === 'INSIDE',
  );

  if (policy === 'AREA_CONTAINED') {
    return {
      passes: relations.every((fact) => fact.relation === 'INSIDE'),
      routeIntersectsArea,
      pointComponentInside,
      components: relations,
    };
  }

  const meaningful = relations.filter((fact) => fact.role !== 'area');
  // A canonical route entering the boundary is the strongest general fact.
  return {
    passes:
      meaningful.length > 0 && (routeIntersectsArea || pointComponentInside),
    routeIntersectsArea,
    pointComponentInside,
    components: relations,
  };
}

/**
 * Relation of one component's canonical geometry to an AREA. The strategy
 * follows the structural geometry, never a name or a flag:
 * - Point (or a PLACE's canonical coordinates) -> point-in-polygon;
 * - LineString / MultiLineString -> real vertex + segment intersection;
 * - Polygon / MultiPolygon -> vertex coverage + edge intersection.
 * A ROUTE/AREA without line/polygon geometry is UNDETERMINED: its
 * representative coordinate is not its geometry.
 */
export function classifyComponentAreaRelation(
  areaGeometry: GeoJsonGeometry | undefined,
  component: AreaScopeComponentFact,
): ComponentAreaRelationFact {
  const basis = geometryBasis(component);
  const base = {
    ...(component.hintKey ? { hintKey: component.hintKey } : {}),
    role: component.role,
    basis,
  };
  if (!isAreaGeometry(areaGeometry) || basis === 'NONE') {
    return { ...base, relation: 'UNDETERMINED' };
  }
  if (basis === 'POINT') {
    const [longitude, latitude] = pointOf(component) as [number, number];
    if (pointCoveredByArea(areaGeometry, [longitude, latitude])) {
      return { ...base, relation: 'INSIDE' };
    }
    const distance = distancePointToPolygonBoundaryMeters(
      areaGeometry,
      longitude,
      latitude,
    );
    return {
      ...base,
      relation: 'OUTSIDE',
      ...(Number.isFinite(distance)
        ? { distanceToBoundaryMeters: distance }
        : {}),
    };
  }

  const geometry = component.geometry as GeoJsonGeometry;
  const paths: Position[][] =
    basis === 'LINE' ? linePaths(geometry) : polygonRings(geometry);
  const vertices = paths.flat();
  const areaRings = polygonRings(areaGeometry);
  const anyVertexStrictlyInside = vertices.some((vertex) =>
    geometryContainsPoint(areaGeometry, vertex[0], vertex[1]),
  );
  const allVerticesCovered = vertices.every((vertex) =>
    pointCoveredByArea(areaGeometry, vertex),
  );
  const anyContact = anySegmentPair(paths, areaRings, segmentsIntersect);
  const anyProperCrossing = anySegmentPair(paths, areaRings, segmentsCross);
  const areaInsideComponent =
    basis === 'POLYGON' &&
    areaRings
      .flat()
      .some((vertex) => geometryContainsPoint(geometry, vertex[0], vertex[1]));

  if (allVerticesCovered && !anyProperCrossing) {
    return { ...base, relation: 'INSIDE' };
  }
  if (anyVertexStrictlyInside || anyContact || areaInsideComponent) {
    return { ...base, relation: 'INTERSECTS' };
  }
  return { ...base, relation: 'OUTSIDE' };
}

/**
 * Relation of one component to a POINT_RADIUS scope (a center + radius
 * destination, not an AREA). Only a point can be related to it without a
 * new line/polygon-to-circle rule; any other canonical geometry stays
 * UNDETERMINED rather than being approximated by a representative point.
 * The radius is the request scope's own, not a policy threshold.
 */
export function classifyComponentPointRadiusRelation(
  scope: { latitude: number; longitude: number; radiusMeters: number },
  component: AreaScopeComponentFact,
): ComponentAreaRelationFact {
  const basis = geometryBasis(component);
  const base = {
    ...(component.hintKey ? { hintKey: component.hintKey } : {}),
    role: component.role,
    basis,
  };
  const point = basis === 'POINT' ? pointOf(component) : undefined;
  if (!point) return { ...base, relation: 'UNDETERMINED' };
  return {
    ...base,
    relation:
      distanceMeters(
        { latitude: point[1], longitude: point[0] },
        { latitude: scope.latitude, longitude: scope.longitude },
      ) <= scope.radiusMeters
        ? 'INSIDE'
        : 'OUTSIDE',
  };
}

function geometryBasis(
  component: AreaScopeComponentFact,
): ComponentGeometryBasis {
  const geometry = asGeometry(component.geometry);
  if (geometry?.type === 'LineString' || geometry?.type === 'MultiLineString') {
    return linePaths(geometry).some((line) => line.length >= 2)
      ? 'LINE'
      : 'NONE';
  }
  if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
    return polygonRings(geometry).some((ring) => ring.length >= 3)
      ? 'POLYGON'
      : 'NONE';
  }
  if (isLinearOrAreal(component)) return 'NONE';
  return pointOf(component) ? 'POINT' : 'NONE';
}

/**
 * A ROUTE or AREA is a line/polygon by nature: without that geometry its
 * relation is unknown, never approximated by a representative point. The
 * canonical kind decides; the structural role is the fallback only when no
 * canonical kind is known.
 */
function isLinearOrAreal(component: AreaScopeComponentFact): boolean {
  if (component.kind) {
    return (
      component.kind === GeoEntityKind.ROUTE ||
      component.kind === GeoEntityKind.AREA
    );
  }
  return component.role === 'route' || component.role === 'area';
}

function pointOf(
  component: AreaScopeComponentFact,
): [number, number] | undefined {
  const geometry = asGeometry(component.geometry);
  if (
    geometry?.type === 'Point' &&
    Number.isFinite(geometry.coordinates?.[0]) &&
    Number.isFinite(geometry.coordinates?.[1])
  ) {
    return [geometry.coordinates[0], geometry.coordinates[1]];
  }
  if (
    Number.isFinite(component.latitude) &&
    Number.isFinite(component.longitude)
  ) {
    return [component.longitude as number, component.latitude as number];
  }
  return undefined;
}

function asGeometry(geometry: unknown): GeoJsonGeometry | undefined {
  return geometry &&
    typeof geometry === 'object' &&
    'type' in geometry &&
    'coordinates' in geometry
    ? (geometry as GeoJsonGeometry)
    : undefined;
}

function linePaths(geometry: GeoJsonGeometry): Position[][] {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function polygonRings(geometry: GeoJsonGeometry): Position[][] {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

function isAreaGeometry(
  geometry: GeoJsonGeometry | undefined,
): geometry is AreaGeometry {
  return (
    !!geometry &&
    (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') &&
    geometry.coordinates.length > 0
  );
}

/** Strictly inside, or exactly on one of the area's edges. */
function pointCoveredByArea(area: AreaGeometry, point: Position): boolean {
  return (
    geometryContainsPoint(area, point[0], point[1]) ||
    polygonRings(area).some((ring) =>
      ring.some((start, index) => {
        const end = ring[(index + 1) % ring.length];
        return (
          orientation(start, end, point) === 0 && onSegment(start, point, end)
        );
      }),
    )
  );
}

function anySegmentPair(
  paths: Position[][],
  rings: Position[][],
  test: (a: Position, b: Position, c: Position, d: Position) => boolean,
): boolean {
  return paths.some((path) =>
    path.some((start, index) => {
      const end = path[index + 1];
      return (
        !!end &&
        rings.some((ring) =>
          ring.some((edgeStart, edgeIndex) =>
            test(start, end, edgeStart, ring[(edgeIndex + 1) % ring.length]),
          ),
        )
      );
    }),
  );
}

function orientation(p: Position, q: Position, r: Position): number {
  return (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
}

function onSegment(p: Position, q: Position, r: Position): boolean {
  return (
    Math.min(p[0], r[0]) <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] &&
    q[1] <= Math.max(p[1], r[1])
  );
}

/** Segments share at least one point (crossing, touching or overlapping). */
function segmentsIntersect(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (
    (o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0) ||
    (o1 === 0 && onSegment(a, c, b)) ||
    (o2 === 0 && onSegment(a, d, b)) ||
    (o3 === 0 && onSegment(c, a, d)) ||
    (o4 === 0 && onSegment(c, b, d))
  );
}

/** Segments cross at one interior point of both (no touching/collinear). */
function segmentsCross(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (
    o1 !== 0 &&
    o2 !== 0 &&
    o3 !== 0 &&
    o4 !== 0 &&
    o1 > 0 !== o2 > 0 &&
    o3 > 0 !== o4 > 0
  );
}
