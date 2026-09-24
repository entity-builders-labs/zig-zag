import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { GeographicPoint } from '../interfaces/geographic-validation.interface';
import { distanceMeters } from './geographic-coherence.util';

type LonLat = [number, number];

/**
 * Minimum distance from `point` to the nearest segment of `geometry`, in
 * meters. LineString, or MultiLineString (one real street made of several
 * OSM ways): the minimum over each real line independently -- lines are
 * never joined, so a gap between segments is never treated as road.
 *
 * Deterministic, real geometry — projects the point onto each segment in a
 * locally-flat (equirectangular) approximation, adequate at street/
 * neighborhood scale, clamps the projection to the segment, then measures
 * the real haversine distance (via `distanceMeters`) from the point to that
 * clamped location. Returns `Infinity` for any other geometry type or an
 * empty/degenerate coordinate list — callers must treat that as "cannot
 * verify, do not silently pass."
 */
export function distancePointToLineStringMeters(
  point: GeographicPoint,
  geometry: GeoJsonGeometry,
): number {
  const lines: LonLat[][] =
    geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [];
  let min = Infinity;
  for (const coordinates of lines) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    for (let i = 0; i < coordinates.length - 1; i += 1) {
      const distance = distancePointToSegmentMeters(
        point,
        coordinates[i],
        coordinates[i + 1],
      );
      if (distance < min) min = distance;
    }
  }
  return min;
}

function distancePointToSegmentMeters(
  point: GeographicPoint,
  segmentStart: LonLat,
  segmentEnd: LonLat,
): number {
  const a: GeographicPoint = {
    longitude: segmentStart[0],
    latitude: segmentStart[1],
  };
  const b: GeographicPoint = {
    longitude: segmentEnd[0],
    latitude: segmentEnd[1],
  };

  // Locally-flat projection: treat longitude/latitude degrees as planar x/y,
  // scaling longitude by cos(latitude) so the projection is not badly
  // skewed at non-equatorial latitudes. Adequate at street/neighborhood
  // scale (the only scale this check is used at); not a general-purpose
  // geodesic projection.
  const latRad = (point.latitude * Math.PI) / 180;
  const lonScale = Math.cos(latRad);

  const ax = a.longitude * lonScale;
  const ay = a.latitude;
  const bx = b.longitude * lonScale;
  const by = b.latitude;
  const px = point.longitude * lonScale;
  const py = point.latitude;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  let t =
    lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const closest: GeographicPoint = {
    longitude: a.longitude + t * (b.longitude - a.longitude),
    latitude: a.latitude + t * (b.latitude - a.latitude),
  };
  return distanceMeters(point, closest);
}
