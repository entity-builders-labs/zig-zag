import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function collectAllPoints(
  geometry: GeoJsonGeometry,
): { lat: number; lon: number }[] {
  const points: { lat: number; lon: number }[] = [];
  const pushRing = (ring: [number, number][]) => {
    for (const [lon, lat] of ring) points.push({ lat, lon });
  };

  if (geometry.type === 'Point') {
    points.push({ lat: geometry.coordinates[1], lon: geometry.coordinates[0] });
  } else if (geometry.type === 'LineString') {
    pushRing(geometry.coordinates);
  } else if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(pushRing);
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon) => polygon.forEach(pushRing));
  }
  return points;
}

/**
 * Derives a center+radius that fully covers a real boundary's own geometry —
 * used to bound ActivitiesService.findAll (still a center+radius query) by
 * a resolved city's actual extent instead of an autocomplete viewport
 * guess. See docs/superpowers/specs/2026-08-21-activity-engine-design.md,
 * "POI sourcing at area scale".
 */
export function boundingBoxToCenterRadius(geometry: GeoJsonGeometry): {
  latitude: number;
  longitude: number;
  radiusMeters: number;
} {
  const points = collectAllPoints(geometry);
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const center = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };

  // Compute distances to all geometry points AND the 4 bounding box corners.
  // For non-rectangular geometries, the farthest point of the bbox from its
  // center is always one of the 4 corners (geometric guarantee). Must include
  // them to guarantee full bbox coverage, not just coverage of geometry vertices.
  const bboxCorners = [
    { lat: minLat, lon: minLon },
    { lat: minLat, lon: maxLon },
    { lat: maxLat, lon: minLon },
    { lat: maxLat, lon: maxLon },
  ];
  const allDistances = [
    ...points.map((p) => haversineMeters(center, p)),
    ...bboxCorners.map((corner) => haversineMeters(center, corner)),
  ];
  const radiusMeters = Math.max(...allDistances);

  return { latitude: center.lat, longitude: center.lon, radiusMeters };
}

/**
 * Builds a provider-neutral polygon scope for point/radius destinations.
 *
 * This is an equirectangular/local-circle approximation (adequate at the
 * city/neighborhood scale this destination-scope fallback operates at),
 * never an exact geodesic circle -- callers needing exact geodesic
 * containment at large radii would need a different projection.
 *
 * Fix (previously a real bug): `radiusMeters / EARTH_RADIUS_METERS` is an
 * angular radius in RADIANS (the standard small-angle arc-length/radius
 * relation). `latitude`/`longitude` are in DEGREES. Adding the two
 * directly -- without the radians→degrees conversion below -- silently
 * produced a polygon smaller than requested by a factor of `180/π` (~57.3x):
 * a requested 12km radius rendered as a real-world radius of only ~209m.
 * Every point-scale-degraded destination (this fallback's only caller) was
 * affected. The previous unit test only checked polygon shape/closure and
 * the center point, never the actual geodesic radius, so this went
 * undetected -- see the new radius-verifying tests below.
 */
export function pointRadiusToGeometry(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  segments = 32,
): GeoJsonGeometry {
  const angularRadiusRadians = radiusMeters / EARTH_RADIUS_METERS;
  const latRadiusDegrees = toDeg(angularRadiusRadians);
  const lonRadiusDegrees =
    latRadiusDegrees / Math.max(Math.cos(toRad(latitude)), 0.1);
  const ring: [number, number][] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    ring.push([
      longitude + lonRadiusDegrees * Math.cos(angle),
      latitude + latRadiusDegrees * Math.sin(angle),
    ]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}
