import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { OsmPlacesService } from '../../../be/src/modules/integrations/osm/services/osm-places.service';
import { osmStructuredAdapter, StructuredProviderFailure, wikidataFactsAdapter } from '../src/adapters/structured';
import { Spike2Catalog } from '../src/catalog';
import { CandidateFacts } from '../src/contracts';
import { discoverAreas, discoverPlaces, discoverRoutes } from '../src/discovery';
import { rankByProminence, rankRoutes } from '../src/offering';
import { GeographyResolutionAuthority, Recorder } from '../src/spike1';
import { CABA, DEST, fakeOsm, fakeRoutes, fakeWikidata } from './fixtures/world2';

const ALL_AREA = ['osm-admin-areas', 'osm-named-places', 'wikidata-area-facts'];
const deps = (catalog = Spike2Catalog.empty(), osm = fakeOsm(), wikidata = fakeWikidata(), strategies = ALL_AREA) => {
  catalog.store.recordGeoEntity(new GeographyResolutionAuthority(), DEST);
  return { catalog, osm, wikidata, routes: fakeRoutes(), destination: DEST, destinationBoundary: CABA, strategies };
};

describe('structured provider adapters (task 13.1)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('named-place query normalizes Overpass elements and keeps tags/center', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ elements: [
      { type: 'node', id: 9001, lat: -34.588, lon: -58.43, tags: { name: 'Palermo Soho', place: 'neighbourhood', wikidata: 'Q7128049' } },
      { type: 'way', id: 5, center: { lat: -34.6, lon: -58.4 }, tags: { name: 'Barrio X', place: 'quarter' } },
      { type: 'node', id: 0, tags: { name: 'bad id' } },
    ] }), { status: 200 }));
    const adapter = osmStructuredAdapter(new Recorder(mkdtempSync(join(tmpdir(), 'sw-')), 'record'), {} as OsmPlacesService, 'http://overpass.local');
    const records = await adapter.namedPlaces(CABA);
    expect(records.map((r) => [r.externalId, r.center])).toEqual([
      ['osm:node:9001', { lat: -34.588, lng: -58.43 }],
      ['osm:way:5', { lat: -34.6, lng: -58.4 }],
    ]);
  });

  it('maps provider failures to errors, never to an empty set', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('busy', { status: 429 }));
    const adapter = osmStructuredAdapter(new Recorder(mkdtempSync(join(tmpdir(), 'sw-')), 'record'), {} as OsmPlacesService, 'http://overpass.local');
    await expect(adapter.walkableStreetNames(CABA)).rejects.toBeInstanceOf(StructuredProviderFailure);
    const osm = { lookupNeighborhoodsWithin: async () => ({ status: 'failed', value: [] as unknown[], failureReason: 'timeout' }) } as unknown as OsmPlacesService;
    await expect(osmStructuredAdapter(new Recorder(mkdtempSync(join(tmpdir(), 'sw-')), 'record'), osm, 'u').adminAreas(CABA)).rejects.toThrow('timeout');
  });

  it('walkable street names exclude non-walkable highway types', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ elements: [
      { type: 'way', id: 1, tags: { name: 'Defensa', highway: 'residential' } },
      { type: 'way', id: 2, tags: { name: 'Autopista 25 de Mayo', highway: 'motorway' } },
      { type: 'way', id: 3, tags: { name: 'Ciclovía Paseo Colón', highway: 'cycleway' } },
      { type: 'way', id: 4, tags: { name: 'Defensa', highway: 'residential' } },
    ] }), { status: 200 }));
    const adapter = osmStructuredAdapter(new Recorder(mkdtempSync(join(tmpdir(), 'sw-')), 'record'), {} as OsmPlacesService, 'u');
    await expect(adapter.walkableStreetNames(CABA)).resolves.toEqual(['Defensa']);
  });

  it('Wikidata facts parse sitelinks, es/en names, heritage designation and museum class', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results: { bindings: [{
      item: { value: 'http://www.wikidata.org/entity/Q2721567' }, sitelinks: { value: '9' },
      names: { value: 'Plaza Dorrego\u001fDorrego Square' }, heritage: { value: 'Q19903688\u001eMonumento Histórico Nacional' }, isMuseum: { value: 'false' },
    }] } }), { status: 200 }));
    const facts = await wikidataFactsAdapter(new Recorder(mkdtempSync(join(tmpdir(), 'sw-')), 'record')).facts(['Q2721567', 'not-a-qid'], 'discovery');
    expect(facts.get('Q2721567')).toEqual({ qid: 'Q2721567', sitelinks: 9, names: ['Dorrego Square', 'Plaza Dorrego'], heritage: [{ qid: 'Q19903688', label: 'Monumento Histórico Nacional' }], museumClass: false });
  });
});

describe('discovery boundary (task 13.2)', () => {
  it('areas: admin with boundary, named place merged only by Wikidata identity, point-only named place UNKNOWN', async () => {
    const d = deps();
    const outcome = await discoverAreas(d);
    const c = d.catalog.snapshot().candidates;
    expect(outcome.status).toBe('SUCCESS');
    expect(c['geo:osm:relation:2223069']).toMatchObject({ areaClass: 'ADMINISTRATIVE', extent: 'PROVIDER_BOUNDARY', wikidataQid: 'Q1034165' });
    expect(c['geo:osm:relation:2223069'].names).toEqual(expect.arrayContaining(['San Telmo', 'Barrio de San Telmo']));
    expect(c['geo:osm:node:9002']).toBeUndefined();
    expect(outcome.excluded).toContainEqual({ externalId: 'osm:node:9002', name: 'San Telmo', reason: 'MERGED_BY_WIKIDATA_INTO geo:osm:relation:2223069' });
    expect(c['geo:osm:node:9001']).toMatchObject({ areaClass: 'NAMED_PLACE', extent: 'UNKNOWN' });
    expect(d.catalog.snapshot().catalog.geoEntities['geo:osm:node:9001'].geometry.type).toBe('Point');
  });

  it('never merges by name similarity: two "Microcentro" records stay two candidates', async () => {
    const d = deps();
    await discoverAreas(d);
    const c = d.catalog.snapshot().candidates;
    expect(c['geo:osm:node:9003']).toBeDefined();
    expect(c['geo:osm:node:9004']).toBeDefined();
  });

  it('places: transit stop named after a park is excluded by canonical structural kind; outside-area POI excluded', async () => {
    const d = deps(undefined, undefined, undefined, ['osm-pois', 'wikidata-place-facts']);
    await discoverAreas({ ...d, strategies: ALL_AREA });
    const area = d.catalog.snapshot().catalog.geoEntities['geo:osm:relation:2223069'];
    const outcome = await discoverPlaces(d, area);
    expect(outcome.candidateIds).toEqual(['geo:osm:node:55', 'geo:osm:node:57', 'geo:osm:way:17441757', 'geo:osm:way:31364659', 'geo:osm:way:99']);
    expect(outcome.excluded).toContainEqual({ externalId: 'osm:node:10910591117', name: 'Parque Lezama', reason: 'STRUCTURAL_KIND_TRANSPORT_STOP' });
    expect(outcome.excluded).toContainEqual({ externalId: 'osm:node:56', name: 'Far Away Museum', reason: 'OUTSIDE_AREA' });
    const plaza = d.catalog.snapshot().candidates['geo:osm:way:31364659'];
    expect(plaza.facts).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'wikidata', field: 'P1435' })]));
    expect(d.catalog.snapshot().catalog.geoEntities['geo:osm:way:17441757'].geometry.type).toBe('Polygon');
  });

  it('places in an area without a provider boundary are not discovered', async () => {
    const d = deps();
    await discoverAreas(d);
    const soho = d.catalog.snapshot().catalog.geoEntities['geo:osm:node:9001'];
    const outcome = await discoverPlaces({ ...d, strategies: ['osm-pois'] }, soho);
    expect(outcome.status).toBe('FAILED');
    expect(outcome.excluded[0].reason).toBe('NO_BOUNDED_AREA');
  });

  it('routes: only canonically resolved streets crossing the area become candidates', async () => {
    const d = deps();
    await discoverAreas(d);
    const area = d.catalog.snapshot().catalog.geoEntities['geo:osm:relation:2223069'];
    const outcome = await discoverRoutes({ ...d, strategies: ['osm-routes'] }, area);
    expect(outcome.candidateIds).toEqual(['geo:osm-route:osm:way:1']);
    expect(outcome.excluded).toContainEqual({ externalId: 'street:Humberto I', name: 'Humberto I', reason: 'ROUTE_AMBIGUOUS' });
  });

  it('provider failure yields FAILED, never an empty candidate set', async () => {
    const failing = fakeOsm({ adminAreas: async () => { throw new StructuredProviderFailure('down'); }, namedPlaces: async () => { throw new StructuredProviderFailure('down'); } });
    const outcome = await discoverAreas(deps(undefined, failing, fakeWikidata(true)));
    expect(outcome.status).toBe('FAILED');
    expect(outcome.runs.map((r) => r.outcome)).toEqual(['FAILED', 'FAILED', 'SKIPPED']);
  });
});

describe('candidate ranking (task 13.3)', () => {
  const facts = (id: string, sitelinks: number | undefined, tags: string[] = []): CandidateFacts => ({
    geoEntityId: id, kind: 'AREA', names: [id], parentAreaIds: [], discoveredBy: { kind: 'AREA', scopeId: 'd', strategies: [] }, facts: [], prominence: { sitelinks, tagSignals: tags },
  });

  it('orders by sitelinks, then tag signals, ties by identity; deterministic', () => {
    const ranked = rankByProminence([facts('b', 5), facts('a', 5), facts('c', 9), facts('d', 5, ['historic:yes'])]);
    expect(ranked.map((r) => r.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('ranking writes nothing to the catalog', async () => {
    const d = deps();
    await discoverAreas(d);
    const before = d.catalog.snapshot();
    rankByProminence(Object.values(before.candidates));
    rankRoutes(before, Object.values(before.candidates).filter((c) => c.kind === 'ROUTE'), [], 150);
    expect(d.catalog.snapshot()).toEqual(before);
  });
});
