import { GeoJsonGeometry } from './osm-geometry.util';

/**
 * Returns whether a point is inside a Polygon/MultiPolygon, respecting holes.
 * Point and LineString geometries are not authoritative containment areas.
 */
export function geometryContainsPoint(
  geometry: GeoJsonGeometry,
  longitude: number,
  latitude: number,
): boolean {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;

  if (geometry.type === 'Polygon') {
    return polygonContainsPoint(geometry.coordinates, longitude, latitude);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) =>
      polygonContainsPoint(polygon, longitude, latitude),
    );
  }
  return false;
}

function polygonContainsPoint(
  rings: number[][][],
  longitude: number,
  latitude: number,
): boolean {
  if (!rings[0] || !ringContainsPoint(rings[0], longitude, latitude)) {
    return false;
  }
  return !rings
    .slice(1)
    .some((hole) => ringContainsPoint(hole, longitude, latitude));
}

function ringContainsPoint(
  ring: number[][],
  longitude: number,
  latitude: number,
): boolean {
  let inside = false;
  for (
    let current = 0, previous = ring.length - 1;
    current < ring.length;
    previous = current++
  ) {
    const [currentLongitude, currentLatitude] = ring[current];
    const [previousLongitude, previousLatitude] = ring[previous];
    const crossesLatitude =
      currentLatitude > latitude !== previousLatitude > latitude;
    const intersectionLongitude =
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;
    if (crossesLatitude && longitude < intersectionLongitude) inside = !inside;
  }
  return inside;
}

/**
 * Returns the shortest distance in meters from a point to a Polygon/MultiPolygon boundary.
 * Returns 0 if the point is inside the polygon (including on the boundary).
 * Returns a positive finite value if the point is outside.
 * Returns Infinity for non-polygon geometries or degenerate cases.
 */
export function distancePointToPolygonBoundaryMeters(
  geometry: GeoJsonGeometry,
  longitude: number,
  latitude: number,
): number {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude))
    return Infinity;

  if (geometry.type === 'Polygon') {
    return distancePointToPolygonBoundary(
      geometry.coordinates,
      longitude,
      latitude,
    );
  }
  if (geometry.type === 'MultiPolygon') {
    let minDistance = Infinity;
    for (const polygon of geometry.coordinates) {
      const distance = distancePointToPolygonBoundary(
        polygon,
        longitude,
        latitude,
      );
      if (distance < minDistance) minDistance = distance;
    }
    return minDistance;
  }
  return Infinity;
}

function distancePointToPolygonBoundary(
  rings: number[][][],
  longitude: number,
  latitude: number,
): number {
  // If point is inside (respecting holes), distance is 0
  if (polygonContainsPoint(rings, longitude, latitude)) {
    return 0;
  }

  // Point is outside: find minimum distance to any ring (exterior or hole)
  let minDistance = Infinity;
  for (const ring of rings) {
    const distance = distancePointToRingMeters(ring, longitude, latitude);
    if (distance < minDistance) minDistance = distance;
  }
  return minDistance;
}

function distancePointToRingMeters(
  ring: number[][],
  longitude: number,
  latitude: number,
): number {
  let minDistance = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    const distance = distancePointToSegmentMeters(
      { longitude, latitude },
      { longitude: lon1, latitude: lat1 },
      { longitude: lon2, latitude: lat2 },
    );
    if (distance < minDistance) minDistance = distance;
  }
  return minDistance;
}

/**
 * Haversine distance between two points in meters.
 */
function distanceMeters(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number },
): number {
  const EARTH_RADIUS_METERS = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const aVal =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Distance from a point to a line segment in meters.
 * Projects the point onto the segment in locally-flat approximation,
 * clamps to segment bounds, then measures haversine distance.
 */
function distancePointToSegmentMeters(
  point: { longitude: number; latitude: number },
  segStart: { longitude: number; latitude: number },
  segEnd: { longitude: number; latitude: number },
): number {
  const latRad = (point.latitude * Math.PI) / 180;
  const lonScale = Math.cos(latRad);

  const ax = segStart.longitude * lonScale;
  const ay = segStart.latitude;
  const bx = segEnd.longitude * lonScale;
  const by = segEnd.latitude;
  const px = point.longitude * lonScale;
  const py = point.latitude;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  let t =
    lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const closestLon =
    segStart.longitude + t * (segEnd.longitude - segStart.longitude);
  const closestLat =
    segStart.latitude + t * (segEnd.latitude - segStart.latitude);

  return distanceMeters(point, { longitude: closestLon, latitude: closestLat });
}
