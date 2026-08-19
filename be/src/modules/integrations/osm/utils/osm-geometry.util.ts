import {
  OverpassElement,
  OverpassRelationMember,
} from '../interfaces/overpass.interface';

type LonLat = [number, number];

export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: LonLat[][] }
  | { type: 'MultiPolygon'; coordinates: LonLat[][][] }
  | { type: 'LineString'; coordinates: LonLat[] };

const COORD_EPSILON = 1e-9;

function pointsEqual(a: LonLat, b: LonLat): boolean {
  return (
    Math.abs(a[0] - b[0]) < COORD_EPSILON &&
    Math.abs(a[1] - b[1]) < COORD_EPSILON
  );
}

function isClosedRing(ring: LonLat[]): boolean {
  return ring.length > 2 && pointsEqual(ring[0], ring[ring.length - 1]);
}

function toLonLat(points: { lat: number; lon: number }[]): LonLat[] {
  return points.map((p): LonLat => [p.lon, p.lat]);
}

/**
 * OSM administrative boundaries are frequently split across several `way`
 * members that share endpoints rather than one single closed way. Greedily
 * chains segments that share an endpoint into as few rings as possible —
 * not a full topological assembly, but correct for the common case of a
 * boundary split into a handful of contiguous segments.
 */
function stitchIntoRings(segments: LonLat[][]): LonLat[][] {
  const pool = segments.filter((seg) => seg.length >= 2).map((seg) => [...seg]);
  const rings: LonLat[][] = [];

  while (pool.length > 0) {
    let ring = pool.shift() as LonLat[];
    let extended = true;

    while (extended && !isClosedRing(ring)) {
      extended = false;
      const ringStart = ring[0];
      const ringEnd = ring[ring.length - 1];

      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i];
        const segStart = seg[0];
        const segEnd = seg[seg.length - 1];

        if (pointsEqual(ringEnd, segStart)) {
          ring = ring.concat(seg.slice(1));
        } else if (pointsEqual(ringEnd, segEnd)) {
          ring = ring.concat([...seg].reverse().slice(1));
        } else if (pointsEqual(ringStart, segEnd)) {
          ring = seg.slice(0, -1).concat(ring);
        } else if (pointsEqual(ringStart, segStart)) {
          ring = [...seg].reverse().slice(0, -1).concat(ring);
        } else {
          continue;
        }

        pool.splice(i, 1);
        extended = true;
        break;
      }
    }

    rings.push(ring);
  }

  return rings;
}

function ringsForRole(
  members: OverpassRelationMember[],
  role: 'outer' | 'inner',
): LonLat[][] {
  const segments = members
    .filter((m) => m.role === role && m.geometry && m.geometry.length >= 2)
    .map((m) => toLonLat(m.geometry as { lat: number; lon: number }[]));

  return stitchIntoRings(segments).filter(isClosedRing);
}

/** Standard ray-casting point-in-polygon test, using the inner ring's first
 * point as a representative — enough to assign a hole to the outer ring
 * that contains it in a MultiPolygon, without a full polygon-in-polygon
 * check on every point. */
function ringContainsPoint(
  outer: LonLat[],
  [testLon, testLat]: LonLat,
): boolean {
  let inside = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const [xi, yi] = outer[i];
    const [xj, yj] = outer[j];
    const crosses =
      yi > testLat !== yj > testLat &&
      testLon < ((xj - xi) * (testLat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function relationToGeoJson(element: OverpassElement): GeoJsonGeometry | null {
  const members = element.members || [];
  const outerRings = ringsForRole(members, 'outer');
  const innerRings = ringsForRole(members, 'inner');

  if (outerRings.length === 0) return null;

  if (outerRings.length === 1) {
    return { type: 'Polygon', coordinates: [outerRings[0], ...innerRings] };
  }

  // Multiple disjoint outer rings (exclaves) -> MultiPolygon. Assign each
  // inner ring (hole) to the first outer ring that contains it.
  return {
    type: 'MultiPolygon',
    coordinates: outerRings.map((outer) => [
      outer,
      ...innerRings.filter((inner) => ringContainsPoint(outer, inner[0])),
    ]),
  };
}

function wayToGeoJson(element: OverpassElement): GeoJsonGeometry | null {
  const coords = toLonLat(element.geometry || []);
  if (coords.length < 2) return null;
  if (isClosedRing(coords)) {
    return { type: 'Polygon', coordinates: [coords] };
  }
  return { type: 'LineString', coordinates: coords };
}

/**
 * Converts a single Overpass `out geom` element (way or relation) into
 * GeoJSON. Returns null for anything without usable geometry (e.g. a node,
 * or a way with fewer than 2 points).
 */
export function overpassElementToGeoJson(
  element: OverpassElement,
): GeoJsonGeometry | null {
  if (element.type === 'way') return wayToGeoJson(element);
  if (element.type === 'relation') return relationToGeoJson(element);
  return null;
}
