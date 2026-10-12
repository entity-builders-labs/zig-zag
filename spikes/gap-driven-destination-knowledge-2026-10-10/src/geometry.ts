import { geometryContainsPoint } from '../../../be/src/modules/integrations/osm/utils/geojson-containment.util';
import { distanceMeters as backendDistanceMeters } from '../../../be/src/modules/tours/utils/real-world-entity-matching.util';
import { GeoGeometry, LngLat } from './contracts';

export function distanceMeters(a: LngLat, b: LngLat): number {
  return backendDistanceMeters({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });
}

export function containsPoint(area: GeoGeometry, point: LngLat): boolean {
  if (area.type !== 'Polygon' && area.type !== 'MultiPolygon') return false;
  return geometryContainsPoint(area, point.lng, point.lat);
}

/** All line vertices of a ROUTE geometry, as one list (multi-way streets). */
export function lineVertices(geometry: GeoGeometry): LngLat[] {
  if (geometry.type === 'LineString') return geometry.coordinates.map(([lng, lat]) => ({ lng, lat }));
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.flat().map(([lng, lat]) => ({ lng, lat }));
  }
  return [];
}

/**
 * Local equirectangular projection around a reference point, meters. Used
 * only to order vertices and points along a street axis; distances that
 * matter for policy use the backend haversine helper.
 */
function toLocal(origin: LngLat, p: LngLat): { x: number; y: number } {
  const k = 111_320;
  return { x: (p.lng - origin.lng) * k * Math.cos((origin.lat * Math.PI) / 180), y: (p.lat - origin.lat) * k };
}

/**
 * Position of `p` along the axis from `start` to `end`, meters (may be
 * negative or exceed the axis length when `p` is outside the bounds).
 */
export function alongAxisMeters(start: LngLat, end: LngLat, p: LngLat): number {
  const e = toLocal(start, end);
  const q = toLocal(start, p);
  const len = Math.hypot(e.x, e.y);
  if (len === 0) return 0;
  return (q.x * e.x + q.y * e.y) / len;
}

/** Nearest vertex of a polyline to a point and its distance. */
export function nearestVertex(vertices: LngLat[], p: LngLat): { vertex: LngLat; meters: number } | undefined {
  let best: { vertex: LngLat; meters: number } | undefined;
  for (const v of vertices) {
    const meters = distanceMeters(v, p);
    if (!best || meters < best.meters) best = { vertex: v, meters };
  }
  return best;
}

/** Minimum distance from a point to a polyline's vertices (vertex-sampled). */
export function distanceToLineMeters(vertices: LngLat[], p: LngLat): number {
  return nearestVertex(vertices, p)?.meters ?? Number.POSITIVE_INFINITY;
}

/**
 * Clips a street to the stretch between two points on/near it: keeps the
 * vertices whose axis position lies between the two bound projections and
 * orders them along the axis. Deterministic. Spike simplification: valid for
 * near-linear streets (e.g. Defensa); a curved or branching street would
 * need graph stitching, which is a production concern.
 */
export function clipBetween(vertices: LngLat[], from: LngLat, to: LngLat): LngLat[] {
  const fromOn = nearestVertex(vertices, from)?.vertex ?? from;
  const toOn = nearestVertex(vertices, to)?.vertex ?? to;
  const length = alongAxisMeters(fromOn, toOn, toOn);
  const inside = vertices
    .map((v) => ({ v, t: alongAxisMeters(fromOn, toOn, v) }))
    .filter(({ t }) => t >= 0 && t <= length)
    .sort((a, b) => a.t - b.t || a.v.lng - b.v.lng || a.v.lat - b.v.lat);
  const unique: LngLat[] = [];
  for (const { v } of inside) {
    const last = unique[unique.length - 1];
    if (!last || last.lng !== v.lng || last.lat !== v.lat) unique.push(v);
  }
  return unique;
}

/** Clips a street to the vertices inside an area, ordered along its axis. */
export function clipToArea(vertices: LngLat[], area: GeoGeometry): LngLat[] {
  const inside = vertices.filter((v) => containsPoint(area, v));
  if (inside.length < 2) return inside;
  // Order along the axis between the two mutually farthest inside vertices.
  let a = inside[0];
  let b = inside[1];
  let best = -1;
  for (const p of inside) for (const q of inside) {
    const d = distanceMeters(p, q);
    if (d > best) { best = d; a = p; b = q; }
  }
  const [start, end] = a.lng < b.lng || (a.lng === b.lng && a.lat <= b.lat) ? [a, b] : [b, a];
  return clipBetween(inside, start, end);
}

export function polylineLengthMeters(line: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += distanceMeters(line[i - 1], line[i]);
  return total;
}

export function centroidOf(geometry: GeoGeometry): LngLat {
  const points: [number, number][] =
    geometry.type === 'Point'
      ? [geometry.coordinates]
      : geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'MultiLineString'
          ? geometry.coordinates.flat()
          : geometry.type === 'Polygon'
            ? geometry.coordinates[0]
            : geometry.coordinates.flatMap((poly) => poly[0]);
  const sum = points.reduce((acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }), { lng: 0, lat: 0 });
  return { lng: sum.lng / points.length, lat: sum.lat / points.length };
}

/** All vertices of any geometry (points, lines, polygon rings). */
export function allVertices(geometry: GeoGeometry): LngLat[] {
  const flat: [number, number][] =
    geometry.type === 'Point'
      ? [geometry.coordinates]
      : geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.type === 'MultiLineString' || geometry.type === 'Polygon'
          ? geometry.coordinates.flat()
          : geometry.coordinates.flat(2);
  return flat.map(([lng, lat]) => ({ lng, lat }));
}

/**
 * The point of an anchor geometry closest to a street (a park touching the
 * street anchors at its edge, not its centroid) and that distance.
 */
export function anchorOnLine(geometry: GeoGeometry, line: LngLat[]): { point: LngLat; meters: number } {
  let best = { point: allVertices(geometry)[0], meters: Number.POSITIVE_INFINITY };
  for (const v of allVertices(geometry)) {
    const meters = distanceToLineMeters(line, v);
    if (meters < best.meters) best = { point: v, meters };
  }
  return best;
}
