type LonLat = [number, number];

export type GeoJsonPolygonGeometry =
  | { type: 'Polygon'; coordinates: LonLat[][] }
  | { type: 'MultiPolygon'; coordinates: LonLat[][][] };

export type GeoJsonLineStringGeometry = {
  type: 'LineString';
  coordinates: LonLat[];
};

export interface PolygonPart {
  outer: { latitude: number; longitude: number }[];
  holes: { latitude: number; longitude: number }[][];
}

function ringToLatLng(
  ring: LonLat[]
): { latitude: number; longitude: number }[] {
  // GeoJSON coordinates are [lon, lat] — the opposite of this app's
  // convention (same gotcha already documented in directions.ts).
  return ring.map(([longitude, latitude]) => ({ latitude, longitude }));
}

/**
 * Converts a GeoJSON LineString boundary (e.g. a top-level kind: route's
 * own Activity.boundary, like "Pasear por Caminito") into this app's
 * {latitude, longitude} route-coordinate convention. This is real, already-
 * final geometry — unlike fetchWalkingRoute's output, nothing needs to be
 * requested or computed, just converted.
 */
export function lineStringToCoordinates(
  geometry: GeoJsonLineStringGeometry | null | undefined
): { latitude: number; longitude: number }[] {
  if (!geometry) return [];
  return ringToLatLng(geometry.coordinates);
}

/**
 * Flattens a GeoJSON Polygon/MultiPolygon boundary (e.g. Activity.boundary
 * for kind: AREA) into a list of polygon "parts" — one per disjoint polygon
 * for a MultiPolygon, or a single part for a plain Polygon — each with its
 * own outer ring and (possibly empty) list of hole rings, already converted
 * to this app's {latitude, longitude} coordinate convention. Each part maps
 * 1:1 onto one entry of MapProps.polygons; no separate "multi-part" prop is
 * needed since that array already supports more than one entry.
 */
export function geoJsonBoundaryToPolygonParts(
  geometry: GeoJsonPolygonGeometry | null | undefined
): PolygonPart[] {
  if (!geometry) return [];

  if (geometry.type === 'Polygon') {
    const [outer, ...holes] = geometry.coordinates;
    if (!outer) return [];
    return [
      {
        outer: ringToLatLng(outer),
        holes: holes.map(ringToLatLng),
      },
    ];
  }

  // MultiPolygon: each top-level entry is itself a [outer, ...holes] polygon.
  return geometry.coordinates
    .filter((polygon) => polygon.length > 0)
    .map(([outer, ...holes]) => ({
      outer: ringToLatLng(outer),
      holes: holes.map(ringToLatLng),
    }));
}
