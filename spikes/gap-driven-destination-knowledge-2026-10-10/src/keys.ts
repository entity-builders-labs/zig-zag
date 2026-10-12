import {
  AssertionSubject,
  ClaimType,
  CorridorSubject,
  FacetKey,
  GapType,
  SegmentBound,
  UnitKind,
} from './contracts';

/**
 * Canonical key builders. Keys are built ONLY from the typed fields passed
 * here: no user, score, day, neighbour, policy version or model output can
 * reach a key because none is a parameter.
 */

function boundToken(bound: SegmentBound): string {
  return bound.kind === 'GEO_ENTITY'
    ? `geo:${bound.geoEntityId}`
    : `area:${bound.areaGeoEntityId}`;
}

/**
 * Corridor bounds are unordered facts (a walk is bidirectional); the
 * canonical order sorts the two bound tokens so the same segment always
 * produces the same key regardless of the order a source states it in.
 */
export function canonicalizeCorridor(corridor: CorridorSubject): CorridorSubject {
  const [a, b] = [corridor.from, corridor.to];
  return boundToken(a) <= boundToken(b)
    ? { ...corridor, from: a, to: b }
    : { ...corridor, from: b, to: a };
}

export function corridorToken(corridor: CorridorSubject): string {
  const c = canonicalizeCorridor(corridor);
  return `route=${c.routeGeoEntityId}|from=${boundToken(c.from)}|to=${boundToken(c.to)}`;
}

export function subjectToken(subject: AssertionSubject): string {
  switch (subject.kind) {
    case 'GEO_ENTITY':
      return `geo=${subject.geoEntityId}`;
    case 'PLACE_IN_AREA':
      return `place=${subject.placeGeoEntityId}|area=${subject.areaGeoEntityId}`;
    case 'CORRIDOR':
      return corridorToken(subject.corridor);
  }
}

export function assertionKey(
  claimType: ClaimType,
  subject: AssertionSubject,
  facetKey: FacetKey,
): string {
  return `${claimType}|${subjectToken(subject)}|facet=${facetKey}`;
}

export function gapKey(
  type: GapType,
  scopeGeoEntityId: string,
  facetKeys: FacetKey[],
): string {
  const facets = [...new Set(facetKeys)].sort().join('+');
  return `${type}|scope=${scopeGeoEntityId}|facet=${facets}`;
}

export function placeVisitKey(placeGeoEntityId: string): string {
  return `PLACE_VISIT|place=${placeGeoEntityId}`;
}

export function corridorWalkKey(corridor: CorridorSubject): string {
  return `CORRIDOR_WALK|${corridorToken(corridor)}`;
}

export function unitKindOfKey(key: string): UnitKind {
  return key.startsWith('PLACE_VISIT|') ? 'PLACE_VISIT' : 'CORRIDOR_WALK';
}
