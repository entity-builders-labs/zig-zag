import { GeoJsonGeometry } from '@shared/geo/geojson-geometry';
import { calculateDistance, Coordinates } from '@shared/utils/distance.utils';

// Same 50 km "still plausibly this destination" scale the Nominatim/Places
// destination biases already share; a larger boundary is still covered by
// the destination-admin compatibility check, only acquisition is bounded.
const MAX_DESTINATION_ACQUISITION_RADIUS_METERS = 50_000;

/**
 * Radius (m) of an `around:` acquisition centered on the destination point
 * that covers the destination's own resolved boundary: the distance to the
 * boundary's farthest bounding-box corner. Scoped by the DESTINATION, never
 * by a neighborhood anchor. Undefined for a point-scale destination (no
 * boundary): callers must treat that as unknown, not invent a radius.
 */
export function destinationAcquisitionRadiusMeters(
  point: Coordinates,
  boundary: GeoJsonGeometry | undefined,
): number | undefined {
  let positions: [number, number][] = [];
  if (boundary?.type === 'Polygon') positions = boundary.coordinates.flat();
  else if (boundary?.type === 'MultiPolygon') {
    positions = boundary.coordinates.flat(2);
  }
  if (positions.length === 0) return undefined;

  const lons = positions.map(([lon]) => lon);
  const lats = positions.map(([, lat]) => lat);
  const corners: Coordinates[] = [
    { latitude: Math.min(...lats), longitude: Math.min(...lons) },
    { latitude: Math.min(...lats), longitude: Math.max(...lons) },
    { latitude: Math.max(...lats), longitude: Math.min(...lons) },
    { latitude: Math.max(...lats), longitude: Math.max(...lons) },
  ];
  const farthest = Math.max(
    ...corners.map((corner) => calculateDistance(point, corner) * 1000),
  );
  return Math.min(
    Math.ceil(farthest),
    MAX_DESTINATION_ACQUISITION_RADIUS_METERS,
  );
}
