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
