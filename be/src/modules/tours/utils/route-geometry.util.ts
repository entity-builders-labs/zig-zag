import { GeoJsonGeometry } from '@integrations/osm/utils/osm-geometry.util';
import { GeographicPoint } from '../interfaces/geographic-validation.interface';
import { distanceMeters } from './geographic-coherence.util';

type LonLat = [number, number];

/**
 * Minimum distance from `point` to the nearest segment of `geometry`, in
 * meters. LineString ONLY (Task B5) — the real `GeoJsonGeometry` type
 * (`osm-geometry.util.ts`) has no `MultiLineString` variant today, and B5
 * v1's canonical ROUTE resolution is itself LineString-only (named OSM
 * highway ways/streets), so there is no real input this needs to handle
 * beyond LineString.
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
  if (geometry.type !== 'LineString') return Infinity;
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return Infinity;

  let min = Infinity;
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const distance = distancePointToSegmentMeters(
      point,
      coordinates[i],
      coordinates[i + 1],
    );
    if (distance < min) min = distance;
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
