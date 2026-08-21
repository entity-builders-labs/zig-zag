import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
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

function collectAllPoints(geometry: GeoJsonGeometry): { lat: number; lon: number }[] {
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
export function boundingBoxToCenterRadius(
  geometry: GeoJsonGeometry,
): { latitude: number; longitude: number; radiusMeters: number } {
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
