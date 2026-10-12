import {
  Assertion,
  CorridorSubject,
  ExperienceStop,
  FacetKey,
  GeoEntityRef,
  ReusableExperience,
} from '../contracts';
import { corridorLine } from '../corridor';
import { alongAxisMeters, distanceToLineMeters, polylineLengthMeters } from '../geometry';
import { canonicalizeCorridor, corridorToken, corridorWalkKey, placeVisitKey } from '../keys';
import { CompositionPolicy } from '../policy';
import { CatalogSnapshot, CatalogStore, ReusableCompositionAuthority } from '../stores';

const COMPOSITION = new ReusableCompositionAuthority();

const sortedUnique = <T extends string>(values: T[]): T[] => [...new Set(values)].sort();

interface PlaceRelevance {
  place: GeoEntityRef;
  assertions: Assertion[];
}

/** Places admitted by an ACTIVE RELEVANT_FOR or NOTABLE_WITHIN assertion. */
function relevantPlaces(snapshot: CatalogSnapshot, destinationId: string): Map<string, PlaceRelevance> {
  const byPlace = new Map<string, PlaceRelevance>();
  for (const a of Object.values(snapshot.assertions)) {
    if (a.status !== 'ACTIVE' || a.destinationId !== destinationId) continue;
    const placeId =
      a.claimType === 'NOTABLE_WITHIN' && a.subject.kind === 'PLACE_IN_AREA'
        ? a.subject.placeGeoEntityId
        : a.claimType === 'RELEVANT_FOR' && a.subject.kind === 'GEO_ENTITY'
          ? a.subject.geoEntityId
          : undefined;
    const place = placeId ? snapshot.geoEntities[placeId] : undefined;
    if (!place || place.kind !== 'PLACE') continue;
    const entry = byPlace.get(place.id) ?? { place, assertions: [] };
    entry.assertions.push(a);
    byPlace.set(place.id, entry);
  }
  return byPlace;
}

function placeVisit(r: PlaceRelevance, policy: CompositionPolicy): ReusableExperience {
  return {
    key: placeVisitKey(r.place.id),
    unitKind: 'PLACE_VISIT',
    anchors: [r.place.id],
    justification: sortedUnique(r.assertions.map((a) => a.key)),
    contentRevision: 1,
    policyVersion: policy.version,
    status: 'ACTIVE',
    content: {
      name: r.place.name,
      stops: [{ geoEntityId: r.place.id, name: r.place.name, point: r.place.centroid, required: true }],
      durationMinutes: policy.placeVisitDwellMinutes,
      footprint: { type: 'POINT', point: r.place.centroid },
      facetKeys: sortedUnique(r.assertions.map((a) => a.facetKey)),
    },
  };
}

function corridorName(snapshot: CatalogSnapshot, c: CorridorSubject): string {
  const name = (id: string) => snapshot.geoEntities[id]?.name ?? id;
  const route = name(c.routeGeoEntityId);
  if (c.from.kind === 'AREA_CLIP') return `Walk along ${route} through ${name(c.from.areaGeoEntityId)}`;
  if (c.to.kind !== 'GEO_ENTITY') return `Walk along ${route}`;
  return `Walk along ${route}: ${name(c.from.geoEntityId)} - ${name(c.to.geoEntityId)}`;
}

function corridorWalk(
  snapshot: CatalogSnapshot,
  corridor: CorridorSubject,
  assertions: Assertion[],
  places: Map<string, PlaceRelevance>,
  policy: CompositionPolicy,
): ReusableExperience | undefined {
  const line = corridorLine(snapshot.geoEntities, corridor);
  if (line.status !== 'OK') return undefined;
  const start = line.line[0];
  const end = line.line[line.line.length - 1];
  const length = polylineLengthMeters(line.line);
  const stops: ExperienceStop[] = [];
  const stopJustification: string[] = [];
  for (const r of [...places.values()].sort((a, b) => a.place.id.localeCompare(b.place.id))) {
    const offset = distanceToLineMeters(line.line, r.place.centroid);
    const along = alongAxisMeters(start, end, r.place.centroid);
    if (offset > policy.corridorStopBufferMeters) continue;
    if (along < -policy.corridorStopBufferMeters || along > length + policy.corridorStopBufferMeters) continue;
    stops.push({ geoEntityId: r.place.id, name: r.place.name, point: r.place.centroid, required: false, alongMeters: Math.round(along) });
    stopJustification.push(...r.assertions.map((a) => a.key));
  }
  stops.sort((a, b) => (a.alongMeters ?? 0) - (b.alongMeters ?? 0) || a.geoEntityId.localeCompare(b.geoEntityId));
  const walkingMinutes = length / ((policy.walkingSpeedKmh * 1000) / 60);
  const c = canonicalizeCorridor(corridor);
  const facetKeys: FacetKey[] = sortedUnique(assertions.map((a) => a.facetKey));
  return {
    key: corridorWalkKey(c),
    unitKind: 'CORRIDOR_WALK',
    anchors: corridorToken(c).split('|'),
    justification: sortedUnique([...assertions.map((a) => a.key), ...stopJustification]),
    contentRevision: 1,
    policyVersion: policy.version,
    status: 'ACTIVE',
    content: {
      name: corridorName(snapshot, c),
      stops,
      durationMinutes: Math.round(walkingMinutes + stops.length * policy.corridorStopDwellMinutes),
      footprint: { type: 'LINE', line: line.line },
      facetKeys,
    },
  };
}

/**
 * Deterministic, request-independent derivation of reusable Experiences
 * from L1/L2 (spec `reusable-experience-composition`). No model choice, no
 * request input: same snapshot + policy -> same keys and content.
 */
export function deriveExperiences(snapshot: CatalogSnapshot, destinationId: string, policy: CompositionPolicy): ReusableExperience[] {
  const places = relevantPlaces(snapshot, destinationId);
  const derived: ReusableExperience[] = [...places.values()].map((r) => placeVisit(r, policy));

  const corridors = new Map<string, { corridor: CorridorSubject; assertions: Assertion[] }>();
  for (const a of Object.values(snapshot.assertions)) {
    if (a.status !== 'ACTIVE' || a.destinationId !== destinationId || a.claimType !== 'WALKING_CORRIDOR' || a.subject.kind !== 'CORRIDOR') continue;
    const token = corridorToken(a.subject.corridor);
    const entry = corridors.get(token) ?? { corridor: a.subject.corridor, assertions: [] };
    entry.assertions.push(a);
    corridors.set(token, entry);
  }
  for (const { corridor, assertions } of corridors.values()) {
    const walk = corridorWalk(snapshot, corridor, assertions, places, policy);
    if (walk) derived.push(walk);
  }
  return derived.sort((a, b) => a.key.localeCompare(b.key));
}

export interface RecompositionReport {
  created: string[];
  revised: string[];
  reactivated: string[];
  unchanged: string[];
  archived: string[];
}

/** Upserts derived Experiences by key and archives those whose admission no longer holds. */
export function recompose(store: CatalogStore, destinationId: string, policy: CompositionPolicy): RecompositionReport {
  const report: RecompositionReport = { created: [], revised: [], reactivated: [], unchanged: [], archived: [] };
  const derived = deriveExperiences(store.snapshot(), destinationId, policy);
  const keep = new Set(derived.map((e) => e.key));
  for (const experience of derived) {
    const outcome = store.upsertExperience(COMPOSITION, experience);
    report[outcome === 'CREATED' ? 'created' : outcome === 'REVISED' ? 'revised' : outcome === 'REACTIVATED' ? 'reactivated' : 'unchanged'].push(experience.key);
  }
  for (const existing of Object.values(store.snapshot().experiences)) {
    if (!keep.has(existing.key) && store.archiveExperience(COMPOSITION, existing.key)) report.archived.push(existing.key);
  }
  return report;
}
