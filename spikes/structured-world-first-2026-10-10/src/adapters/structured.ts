import { OverpassElement } from '../../../../be/src/modules/integrations/osm/interfaces/overpass.interface';
import { OsmCandidate, OsmPlacesService } from '../../../../be/src/modules/integrations/osm/services/osm-places.service';
import { Recorder } from '../spike1';

/**
 * Structured provider adapters for spike 2 (owner decision P2: local OSM +
 * public Wikidata). Backend services are used where they expose the query;
 * queries they do not expose are spike-local, recorded provider calls.
 * Every failure throws; callers map it to FAILED, never to an empty set.
 */

export interface OsmRecord {
  externalId: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  name: string;
  tags: Record<string, string>;
  center?: { lat: number; lng: number };
}

export class StructuredProviderFailure extends Error {}

/** Highway values that are not walkable streets (structural walkability fact). */
const NON_WALKABLE_HIGHWAYS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'cycleway', 'busway', 'bus_guideway', 'construction', 'proposed']);

export interface OsmStructuredAdapter {
  adminAreas(destination: OsmCandidate): Promise<OsmRecord[]>;
  namedPlaces(destination: OsmCandidate): Promise<OsmRecord[]>;
  pois(area: OsmCandidate): Promise<OsmRecord[]>;
  walkableStreetNames(area: OsmCandidate): Promise<string[]>;
  boundary(osmType: 'way' | 'relation', osmId: number): Promise<OsmCandidate>;
  elementTags(osmType: 'node' | 'way' | 'relation', osmId: number): Promise<Record<string, string>>;
}

function fromCandidate(c: OsmCandidate): OsmRecord {
  const g = c.geometry as { type: string; coordinates: unknown };
  const center = g.type === 'Point' ? { lng: (g.coordinates as number[])[0], lat: (g.coordinates as number[])[1] } : undefined;
  return { externalId: c.id, osmType: c.osmType, osmId: c.osmId, name: c.name, tags: c.tags, ...(center ? { center } : {}) };
}

function fromElement(e: OverpassElement & { center?: { lat: number; lon: number } }): OsmRecord | undefined {
  const name = e.tags?.name;
  if (!name || !Number.isInteger(e.id) || e.id <= 0) return undefined;
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  return {
    externalId: `osm:${e.type}:${e.id}`,
    osmType: e.type,
    osmId: e.id,
    name,
    tags: e.tags ?? {},
    ...(lat !== undefined && lon !== undefined ? { center: { lat, lng: lon } } : {}),
  };
}

function areaSelector(c: OsmCandidate): string {
  if (c.osmType === 'node') throw new StructuredProviderFailure(`${c.id} has no area`);
  return `${c.osmType}(${c.osmId});map_to_area->.a;`;
}

export function osmStructuredAdapter(recorder: Recorder, osm: OsmPlacesService, overpassUrl: string): OsmStructuredAdapter {
  const raw = (operation: string, query: string) =>
    recorder.call('overpass-raw', operation, { query }, async () => {
      const response = await fetch(overpassUrl, { method: 'POST', body: new URLSearchParams({ data: query }) });
      if (!response.ok) throw new StructuredProviderFailure(`overpass HTTP ${response.status}`);
      const json = (await response.json()) as { elements?: OverpassElement[] };
      if (!Array.isArray(json.elements)) throw new StructuredProviderFailure('overpass returned no elements array');
      return json.elements;
    });
  return {
    async adminAreas(destination) {
      const r = await osm.lookupNeighborhoodsWithin(destination);
      if (r.status !== 'success') throw new StructuredProviderFailure(r.failureReason ?? 'neighbourhood lookup failed');
      return r.value.map(fromCandidate);
    },
    async namedPlaces(destination) {
      const els = await raw('named-places', `[out:json][timeout:60];${areaSelector(destination)}nwr["place"~"^(neighbourhood|quarter)$"]["name"](area.a);out tags center;`);
      return els.map(fromElement).filter((r): r is OsmRecord => !!r);
    },
    async pois(area) {
      const r = await osm.lookupPoisWithin(area);
      if (r.status !== 'success') throw new StructuredProviderFailure(r.failureReason ?? 'POI lookup failed');
      return r.value.map(fromCandidate);
    },
    async walkableStreetNames(area) {
      const els = await raw('streets-within', `[out:json][timeout:60];${areaSelector(area)}way["highway"]["name"](area.a);out tags;`);
      return [...new Set(els.filter((e) => e.tags?.name && !NON_WALKABLE_HIGHWAYS.has(e.tags.highway ?? '')).map((e) => e.tags?.name as string))].sort();
    },
    async boundary(osmType, osmId) {
      const r = await osm.lookupBoundaryById(osmType, osmId);
      if (r.status !== 'success' || !r.value) throw new StructuredProviderFailure(`boundary ${osmType}/${osmId} unavailable`);
      return r.value;
    },
    async elementTags(osmType, osmId) {
      const els = await raw('element-tags', `[out:json][timeout:25];${osmType}(${osmId});out tags;`);
      if (els.length === 0) throw new StructuredProviderFailure(`element ${osmType}/${osmId} not found`);
      return els[0].tags ?? {};
    },
  };
}

export interface WikidataFacts {
  qid: string;
  sitelinks: number;
  names: string[];
  heritage: Array<{ qid: string; label: string }>;
  museumClass: boolean;
}

export interface WikidataFactsAdapter {
  facts(qids: string[], purpose: 'discovery' | 'refetch'): Promise<Map<string, WikidataFacts>>;
}

const SPARQL_URL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'ZigZagSpike/0.2 (structured-world-first research spike)';
const MUSEUM = 'Q33506';
const QID = /^Q\d+$/;

type Binding = Record<string, { value: string } | undefined>;

/** Batch structured facts for QIDs: sitelinks, es/en labels+aliases, heritage designation (P1435), museum class. */
export function wikidataFactsAdapter(recorder: Recorder): WikidataFactsAdapter {
  return {
    async facts(qids, purpose) {
      const valid = [...new Set(qids.filter((q) => QID.test(q)))].sort();
      const out = new Map<string, WikidataFacts>();
      for (let i = 0; i < valid.length; i += 40) {
        const chunk = valid.slice(i, i + 40);
        const query = `SELECT ?item ?sitelinks
  (GROUP_CONCAT(DISTINCT ?name; separator="\\u001f") AS ?names)
  (GROUP_CONCAT(DISTINCT CONCAT(STRAFTER(STR(?her),"entity/"),"\\u001e",?herLabel); separator="\\u001f") AS ?heritage)
  (SAMPLE(?museum) AS ?isMuseum)
WHERE {
  VALUES ?item { ${chunk.map((q) => `wd:${q}`).join(' ')} }
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?item rdfs:label|skos:altLabel ?name . FILTER(LANG(?name) IN ("es","en")) }
  OPTIONAL { ?item wdt:P1435 ?her . ?her rdfs:label ?herLabel . FILTER(LANG(?herLabel) = "es") }
  BIND(EXISTS { ?item wdt:P31/wdt:P279* wd:${MUSEUM} } AS ?museum)
} GROUP BY ?item ?sitelinks`;
        const bindings = await recorder.call('wikidata', `sparql-facts-${purpose}`, { qids: chunk }, async () => {
          const response = await fetch(`${SPARQL_URL}?query=${encodeURIComponent(query)}`, {
            headers: { accept: 'application/sparql-results+json', 'user-agent': USER_AGENT },
          });
          if (!response.ok) throw new StructuredProviderFailure(`wikidata HTTP ${response.status}`);
          const json = (await response.json()) as { results: { bindings: Binding[] } };
          return json.results.bindings;
        });
        for (const b of bindings) {
          const qid = (b.item?.value ?? '').split('/').pop() ?? '';
          if (!QID.test(qid)) continue;
          const split = (v?: string) => (v ? v.split('\u001f').filter(Boolean) : []);
          out.set(qid, {
            qid,
            sitelinks: Number(b.sitelinks?.value ?? 0),
            names: split(b.names?.value).sort(),
            heritage: split(b.heritage?.value).map((h) => {
              const [hq, label] = h.split('\u001e');
              return { qid: hq, label };
            }).filter((h) => QID.test(h.qid)),
            museumClass: b.isMuseum?.value === 'true',
          });
        }
      }
      return out;
    },
  };
}
