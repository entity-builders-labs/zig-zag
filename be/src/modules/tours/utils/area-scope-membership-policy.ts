import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';
import {
  AreaScopeComponentFact,
  AreaScopeMembershipDecision,
  AreaScopeMembershipPolicy,
} from '../interfaces/area-scope-membership.interface';

/**
 * Canonical area membership semantics shared by acquisition validation and
 * catalog reuse. Anchored routes need a real route/point relationship with
 * the area; they do not inherit strict containment for every component.
 */
export function evaluateAreaScopeMembership(
  areaGeometry: GeoJsonGeometry | undefined,
  components: AreaScopeComponentFact[],
  policy: AreaScopeMembershipPolicy,
): AreaScopeMembershipDecision {
  if (!isAreaGeometry(areaGeometry)) {
    return {
      passes: false,
      routeIntersectsArea: false,
      requiredPointInside: false,
    };
  }
  const required = components.filter((component) => component.required);
  if (required.length === 0) {
    return {
      passes: false,
      routeIntersectsArea: false,
      requiredPointInside: false,
    };
  }

  const routeIntersectsArea = required.some(
    (component) =>
      component.role === 'route' &&
      geometryHasPointInArea(component.geometry, areaGeometry),
  );
  const requiredPointInside = required.some(
    (component) =>
      component.role !== 'area' && pointIsInArea(areaGeometry, component),
  );

  if (policy === 'AREA_CONTAINED') {
    return {
      passes: required.every((component) =>
        pointIsInArea(areaGeometry, component),
      ),
      routeIntersectsArea,
      requiredPointInside,
    };
  }

  const meaningful = required.filter((component) => component.role !== 'area');
  if (meaningful.length === 0) {
    return { passes: false, routeIntersectsArea, requiredPointInside };
  }

  // A canonical route entering the boundary is the strongest general fact.
  return {
    passes: routeIntersectsArea || requiredPointInside,
    routeIntersectsArea,
    requiredPointInside,
  };
}

function isAreaGeometry(
  geometry: GeoJsonGeometry | undefined,
): geometry is Extract<GeoJsonGeometry, { type: 'Polygon' | 'MultiPolygon' }> {
  return (
    !!geometry &&
    (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') &&
    geometry.coordinates.length > 0
  );
}

function pointIsInArea(
  areaGeometry: Extract<GeoJsonGeometry, { type: 'Polygon' | 'MultiPolygon' }>,
  component: AreaScopeComponentFact,
): boolean {
  return (
    Number.isFinite(component.latitude) &&
    Number.isFinite(component.longitude) &&
    geometryContainsPoint(
      areaGeometry,
      component.longitude as number,
      component.latitude as number,
    )
  );
}

function geometryHasPointInArea(
  geometry: unknown,
  areaGeometry: Extract<GeoJsonGeometry, { type: 'Polygon' | 'MultiPolygon' }>,
): boolean {
  if (!geometry || typeof geometry !== 'object' || !('type' in geometry)) {
    return false;
  }
  const candidate = geometry as GeoJsonGeometry;
  if (candidate.type === 'LineString') {
    if (
      candidate.coordinates.some(([longitude, latitude]) =>
        geometryContainsPoint(areaGeometry, longitude, latitude),
      )
    ) {
      return true;
    }
    const polygons =
      areaGeometry.type === 'Polygon'
        ? [areaGeometry.coordinates]
        : areaGeometry.coordinates;
    return polygons.some((polygon) =>
      polygon[0]
        ? candidate.coordinates.some((point, index) => {
            const next = candidate.coordinates[index + 1];
            return (
              !!next &&
              polygon[0].some((edgeStart, edgeIndex) => {
                const edgeEnd = polygon[0][(edgeIndex + 1) % polygon[0].length];
                return segmentsIntersect(point, next, edgeStart, edgeEnd);
              })
            );
          })
        : false,
    );
  }
  if (candidate.type === 'Point') {
    return geometryContainsPoint(
      areaGeometry,
      candidate.coordinates[0],
      candidate.coordinates[1],
    );
  }
  return false;
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: number[],
  d: number[],
): boolean {
  const orientation = (
    p: [number, number] | number[],
    q: [number, number] | number[],
    r: [number, number] | number[],
  ) => (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  const onSegment = (
    p: [number, number] | number[],
    q: [number, number] | number[],
    r: [number, number] | number[],
  ) =>
    Math.min(p[0], r[0]) <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] &&
    q[1] <= Math.max(p[1], r[1]);
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
