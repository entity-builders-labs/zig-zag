import { OsmCandidate } from '../../../be/src/modules/integrations/osm/services/osm-places.service';
import { structuralKindFromOsmTags } from '../../../be/src/modules/tours/utils/candidate-structural-kind.util';
import { OsmRecord, OsmStructuredAdapter, WikidataFactsAdapter } from './adapters/structured';
import { Spike2Catalog } from './catalog';
import { CandidateFacts, DiscoveryKind, StructuredFact } from './contracts';
import { StrategyRun } from './routing';
import {
  GeoEntityRef,
  GeoGeometry,
  GeographyResolutionAuthority,
  OsmGeoResolver,
  centroidOf,
  containsPoint,
  lineVertices,
} from './spike1';

const GEOGRAPHY = new GeographyResolutionAuthority();

export interface DiscoveryOutcome {
  kind: DiscoveryKind;
  scopeId: string;
  status: 'SUCCESS' | 'EMPTY' | 'FAILED';
  acquired: number;
  candidateIds: string[];
  excluded: Array<{ externalId: string; name: string; reason: string }>;
  runs: StrategyRun[];
}

export interface DiscoveryDeps {
  catalog: Spike2Catalog;
  osm: OsmStructuredAdapter;
  wikidata: WikidataFactsAdapter;
  routes: OsmGeoResolver;
  destination: GeoEntityRef;
  destinationBoundary: OsmCandidate;
  /** Structured strategies the router selected for this gap. */
  strategies: string[];
}

/** Provider names/aliases only (never model text). */
export function osmNames(record: Pick<OsmRecord, 'name' | 'tags'>): string[] {
  const t = record.tags;
  return [...new Set([record.name, t['name:es'], t['name:en'], t.official_name, ...(t.alt_name ?? '').split(';')].filter((n): n is string => !!n && !!n.trim()).map((n) => n.trim()))];
}

function osmFacts(record: OsmRecord): StructuredFact[] {
  return ['tourism', 'historic', 'amenity', 'leisure', 'heritage']
    .filter((k) => record.tags[k])
    .map((k) => ({ source: 'openstreetmap' as const, recordId: record.externalId, field: `tag:${k}`, value: record.tags[k] }));
}

function tagSignals(record: OsmRecord): string[] {
  const s = ['tourism', 'historic'].filter((k) => record.tags[k]).map((k) => `${k}:${record.tags[k]}`);
  if (record.tags.wikipedia) s.push('wikipedia');
  return s.sort();
}

function geometryOf(c: OsmCandidate): GeoGeometry {
  return c.geometry as unknown as GeoGeometry;
}

function entityOf(record: OsmRecord, kind: GeoEntityRef['kind'], geometry: GeoGeometry): GeoEntityRef {
  return {
    id: `geo:${record.externalId}`,
    kind,
    name: record.name,
    identities: [{ provider: 'openstreetmap', externalId: record.externalId }],
    geometry,
    centroid: record.center ? { lng: record.center.lng, lat: record.center.lat } : centroidOf(geometry),
  };
}

const isPolygon = (g: GeoGeometry) => g.type === 'Polygon' || g.type === 'MultiPolygon';

/** OsmCandidate view of an L1 area for adapter queries (identity + geometry only). */
export function osmCandidateOf(entity: GeoEntityRef): OsmCandidate | undefined {
  const identity = entity.identities.find((i) => i.provider === 'openstreetmap');
  const m = identity ? /^osm:(way|relation):(\d+)$/.exec(identity.externalId) : null;
  if (!m) return undefined;
  return { id: identity.externalId, name: entity.name, osmType: m[1] as 'way' | 'relation', osmId: Number(m[2]), geometry: entity.geometry as never, tags: {} };
}

async function run<T>(id: string, sourceClass: StrategyRun['sourceClass'], runs: StrategyRun[], fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await fn();
    runs.push({ strategyId: id, sourceClass, outcome: Array.isArray(value) && value.length === 0 ? 'EMPTY' : 'SUCCESS' });
    return value;
  } catch (error) {
    runs.push({ strategyId: id, sourceClass, outcome: 'FAILED', detail: (error as Error).message });
    return undefined;
  }
}

function finish(kind: DiscoveryKind, scopeId: string, runs: StrategyRun[], acquired: number, ids: string[], excluded: DiscoveryOutcome['excluded']): DiscoveryOutcome {
  const anySuccess = runs.some((r) => r.outcome === 'SUCCESS' || r.outcome === 'EMPTY');
  const status = ids.length > 0 ? 'SUCCESS' : anySuccess ? 'EMPTY' : 'FAILED';
  return { kind, scopeId, status, acquired, candidateIds: [...new Set(ids)].sort(), excluded, runs };
}

async function attachWikidataFacts(deps: DiscoveryDeps, ids: string[], strategyId: string, runs: StrategyRun[]) {
  const snapshot = deps.catalog.snapshot();
  const byQid = new Map<string, string[]>();
  for (const id of ids) {
    const q = snapshot.candidates[id]?.wikidataQid;
    if (q) byQid.set(q, [...(byQid.get(q) ?? []), id]);
  }
  if (byQid.size === 0) {
    runs.push({ strategyId, sourceClass: 'STRUCTURED_ENTITY_FACTS', outcome: 'SKIPPED', detail: 'no wikidata-linked candidates' });
    return;
  }
  const facts = await run(strategyId, 'STRUCTURED_ENTITY_FACTS', runs, () => deps.wikidata.facts([...byQid.keys()], 'discovery'));
  if (!facts) return;
  for (const [qid, f] of facts) {
    const structured: StructuredFact[] = [
      ...f.heritage.map((h) => ({ source: 'wikidata' as const, recordId: qid, field: 'P1435', value: h.qid, label: h.label })),
      ...(f.museumClass ? [{ source: 'wikidata' as const, recordId: qid, field: 'class:museum', value: 'true' }] : []),
    ];
    for (const id of byQid.get(qid) ?? []) deps.catalog.addFacts(GEOGRAPHY, id, { facts: structured, sitelinks: f.sitelinks, names: f.names });
  }
}

/** AREA_CANDIDATES: administrative subdivisions + structured named places, then Wikidata facts. */
export async function discoverAreas(deps: DiscoveryDeps): Promise<DiscoveryOutcome> {
  const runs: StrategyRun[] = [];
  const excluded: DiscoveryOutcome['excluded'] = [];
  const ids: string[] = [];
  let acquired = 0;
  const scopeId = deps.destination.id;
  const admins: Array<{ entity: GeoEntityRef; qid?: string }> = [];

  if (deps.strategies.includes('osm-admin-areas')) {
    const records = await run('osm-admin-areas', 'GEOGRAPHIC_STRUCTURE', runs, () => deps.osm.adminAreas(deps.destinationBoundary));
    for (const r of records ?? []) {
      acquired += 1;
      if (r.osmType === 'node') { excluded.push({ externalId: r.externalId, name: r.name, reason: 'ADMIN_WITHOUT_BOUNDARY' }); continue; }
      let boundary: OsmCandidate;
      try {
        boundary = await deps.osm.boundary(r.osmType, r.osmId);
      } catch (error) {
        excluded.push({ externalId: r.externalId, name: r.name, reason: `BOUNDARY_UNAVAILABLE: ${(error as Error).message}` });
        continue;
      }
      const entity = deps.catalog.recordCandidate(GEOGRAPHY, entityOf(r, 'AREA', geometryOf(boundary)), {
        kind: 'AREA', names: osmNames(r), areaClass: 'ADMINISTRATIVE', extent: 'PROVIDER_BOUNDARY', parentAreaIds: [],
        discoveredBy: { kind: 'AREA', scopeId, strategies: ['osm-admin-areas'] },
        ...(r.tags.wikidata ? { wikidataQid: r.tags.wikidata } : {}), facts: osmFacts(r), prominence: { tagSignals: tagSignals(r) },
      });
      admins.push({ entity, ...(r.tags.wikidata ? { qid: r.tags.wikidata } : {}) });
      ids.push(entity.id);
    }
  }

  if (deps.strategies.includes('osm-named-places')) {
    const records = await run('osm-named-places', 'GEOGRAPHIC_STRUCTURE', runs, () => deps.osm.namedPlaces(deps.destinationBoundary));
    for (const r of records ?? []) {
      acquired += 1;
      if (!r.center) { excluded.push({ externalId: r.externalId, name: r.name, reason: 'NO_GEOMETRY' }); continue; }
      if (!containsPoint(deps.destination.geometry, r.center)) { excluded.push({ externalId: r.externalId, name: r.name, reason: 'OUTSIDE_DESTINATION' }); continue; }
      // Strong-identity merge: a named place linked to the same Wikidata item as an administrative area IS that area.
      const sameAdmin = r.tags.wikidata ? admins.find((a) => a.qid === r.tags.wikidata) : undefined;
      if (sameAdmin) {
        deps.catalog.addFacts(GEOGRAPHY, sameAdmin.entity.id, { facts: osmFacts(r), names: osmNames(r) });
        excluded.push({ externalId: r.externalId, name: r.name, reason: `MERGED_BY_WIKIDATA_INTO ${sameAdmin.entity.id}` });
        continue;
      }
      let geometry: GeoGeometry = { type: 'Point', coordinates: [r.center.lng, r.center.lat] };
      let extent: CandidateFacts['extent'] = 'UNKNOWN';
      if (r.osmType !== 'node') {
        try {
          const b = await deps.osm.boundary(r.osmType, r.osmId);
          if (isPolygon(geometryOf(b))) { geometry = geometryOf(b); extent = 'PROVIDER_BOUNDARY'; }
        } catch {
          // keep point geometry; extent stays UNKNOWN (never synthesized)
        }
      }
      const parents = admins.filter((a) => containsPoint(a.entity.geometry, r.center as { lng: number; lat: number })).map((a) => a.entity.id);
      const entity = deps.catalog.recordCandidate(GEOGRAPHY, entityOf(r, 'AREA', geometry), {
        kind: 'AREA', names: osmNames(r), areaClass: 'NAMED_PLACE', extent, parentAreaIds: parents,
        discoveredBy: { kind: 'AREA', scopeId, strategies: ['osm-named-places'] },
        ...(r.tags.wikidata ? { wikidataQid: r.tags.wikidata } : {}), facts: osmFacts(r), prominence: { tagSignals: tagSignals(r) },
      });
      ids.push(entity.id);
    }
  }

  if (deps.strategies.includes('wikidata-area-facts')) await attachWikidataFacts(deps, ids, 'wikidata-area-facts', runs);
  return finish('AREA', scopeId, runs, acquired, ids, excluded);
}

/**
 * Canonical structural kinds that are visitable. UNKNOWN stays visitable:
 * historic-only features (monuments, memorials) have no POI key in the
 * canonical classifier; only explicitly non-visitable kinds are excluded.
 */
const VISITABLE = new Set(['POINT_OF_INTEREST', 'NATURAL_FEATURE', 'UNKNOWN']);

/** PLACE_CANDIDATES within an area that has a provider boundary. */
export async function discoverPlaces(deps: DiscoveryDeps, area: GeoEntityRef): Promise<DiscoveryOutcome> {
  const runs: StrategyRun[] = [];
  const excluded: DiscoveryOutcome['excluded'] = [];
  const ids: string[] = [];
  let acquired = 0;
  const areaOsm = osmCandidateOf(area);
  if (!areaOsm || !isPolygon(area.geometry)) {
    runs.push({ strategyId: 'osm-pois', sourceClass: 'STRUCTURED_POI', outcome: 'FAILED', detail: 'area has no provider boundary' });
    return finish('PLACE', area.id, runs, 0, [], [{ externalId: area.id, name: area.name, reason: 'NO_BOUNDED_AREA' }]);
  }
  if (deps.strategies.includes('osm-pois')) {
    const records = await run('osm-pois', 'STRUCTURED_POI', runs, () => deps.osm.pois(areaOsm));
    for (const r of records ?? []) {
      acquired += 1;
      const kind = structuralKindFromOsmTags(r.tags);
      if (!VISITABLE.has(kind)) { excluded.push({ externalId: r.externalId, name: r.name, reason: `STRUCTURAL_KIND_${kind}` }); continue; }
      if (!r.center || !containsPoint(area.geometry, r.center)) { excluded.push({ externalId: r.externalId, name: r.name, reason: 'OUTSIDE_AREA' }); continue; }
      let geometry: GeoGeometry = { type: 'Point', coordinates: [r.center.lng, r.center.lat] };
      if (r.osmType !== 'node') {
        try {
          const b = await deps.osm.boundary(r.osmType, r.osmId);
          geometry = geometryOf(b);
        } catch {
          // provider point stays the geometry
        }
      }
      const entity = deps.catalog.recordCandidate(GEOGRAPHY, entityOf(r, 'PLACE', geometry), {
        kind: 'PLACE', names: osmNames(r), parentAreaIds: [area.id],
        discoveredBy: { kind: 'PLACE', scopeId: area.id, strategies: ['osm-pois'] },
        ...(r.tags.wikidata ? { wikidataQid: r.tags.wikidata } : {}), facts: osmFacts(r), prominence: { tagSignals: tagSignals(r) },
      });
      ids.push(entity.id);
    }
  }
  if (deps.strategies.includes('wikidata-place-facts')) await attachWikidataFacts(deps, ids, 'wikidata-place-facts', runs);
  return finish('PLACE', area.id, runs, acquired, ids, excluded);
}

/** ROUTE_CANDIDATES: walkable named streets crossing the area, each resolved canonically. */
export async function discoverRoutes(deps: DiscoveryDeps, area: GeoEntityRef): Promise<DiscoveryOutcome> {
  const runs: StrategyRun[] = [];
  const excluded: DiscoveryOutcome['excluded'] = [];
  const ids: string[] = [];
  const areaOsm = osmCandidateOf(area);
  if (!areaOsm || !isPolygon(area.geometry)) {
    runs.push({ strategyId: 'osm-routes', sourceClass: 'ROUTE_GEOMETRY', outcome: 'FAILED', detail: 'area has no provider boundary' });
    return finish('ROUTE', area.id, runs, 0, [], [{ externalId: area.id, name: area.name, reason: 'NO_BOUNDED_AREA' }]);
  }
  const names = await run('osm-routes', 'ROUTE_GEOMETRY', runs, () => deps.osm.walkableStreetNames(areaOsm));
  for (const name of names ?? []) {
    const r = await deps.routes.resolveRoute(name, { destination: deps.destination });
    if (r.status !== 'RESOLVED') { excluded.push({ externalId: `street:${name}`, name, reason: `ROUTE_${r.status}` }); continue; }
    if (!lineVertices(r.entity.geometry).some((v) => containsPoint(area.geometry, v))) {
      excluded.push({ externalId: r.entity.id, name, reason: 'RESOLVED_ROUTE_NOT_IN_AREA' });
      continue;
    }
    const entity = deps.catalog.recordCandidate(GEOGRAPHY, r.entity, {
      kind: 'ROUTE', names: [name], parentAreaIds: [area.id],
      discoveredBy: { kind: 'ROUTE', scopeId: area.id, strategies: ['osm-routes'] }, facts: [], prominence: { tagSignals: [] },
    });
    ids.push(entity.id);
  }
  return finish('ROUTE', area.id, runs, names?.length ?? 0, ids, excluded);
}
