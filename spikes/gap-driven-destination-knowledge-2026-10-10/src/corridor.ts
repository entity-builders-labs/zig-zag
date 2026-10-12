import { CorridorSubject, GeoEntityRef, LngLat } from './contracts';
import { canonicalizeCorridor } from './keys';
import { anchorOnLine, clipBetween, clipToArea, lineVertices } from './geometry';

export type CorridorLineResult =
  | { status: 'OK'; line: LngLat[] }
  | { status: 'UNRESOLVED'; reason: string };

/**
 * Derives a corridor's segment geometry from L1 only: the base ROUTE
 * geometry clipped between stated anchors, or to the named area. Never
 * invents endpoints; returns UNRESOLVED when L1 cannot produce a segment.
 */
export function corridorLine(
  geoEntities: Readonly<Record<string, GeoEntityRef>>,
  subject: CorridorSubject,
): CorridorLineResult {
  const corridor = canonicalizeCorridor(subject);
  const route = geoEntities[corridor.routeGeoEntityId];
  if (!route || route.kind !== 'ROUTE') return { status: 'UNRESOLVED', reason: 'base route not in L1' };
  const vertices = lineVertices(route.geometry);
  if (vertices.length < 2) return { status: 'UNRESOLVED', reason: 'base route has no line geometry' };

  if (corridor.boundKind === 'AREA_CLIP') {
    if (corridor.from.kind !== 'AREA_CLIP') return { status: 'UNRESOLVED', reason: 'area clip without area bound' };
    const area = geoEntities[corridor.from.areaGeoEntityId];
    if (!area) return { status: 'UNRESOLVED', reason: 'clip area not in L1' };
    const line = clipToArea(vertices, area.geometry);
    return line.length >= 2 ? { status: 'OK', line } : { status: 'UNRESOLVED', reason: 'route does not cross area' };
  }

  if (corridor.from.kind !== 'GEO_ENTITY' || corridor.to.kind !== 'GEO_ENTITY') {
    return { status: 'UNRESOLVED', reason: 'stated anchors must be GeoEntities' };
  }
  const from = geoEntities[corridor.from.geoEntityId];
  const to = geoEntities[corridor.to.geoEntityId];
  if (!from || !to) return { status: 'UNRESOLVED', reason: 'anchor not in L1' };
  const line = clipBetween(vertices, anchorOnLine(from.geometry, vertices).point, anchorOnLine(to.geometry, vertices).point);
  return line.length >= 2 ? { status: 'OK', line } : { status: 'UNRESOLVED', reason: 'anchors do not bound a stretch' };
}
