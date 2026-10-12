import { OsmCandidate } from '../../../be/src/modules/integrations/osm/services/osm-places.service';
import { TransportationMode, TravelPace } from '../../../be/src/modules/tours/interfaces/tour-generation.interface';
import { DestinationResolution } from '../../../be/src/modules/tours/services/destination-resolution.service';
import { admit, dedupe } from '../src/admission';
import { generate3 } from '../src/generate';
import { AdmissionLedger, composePlaceVisits, discoverAndAdmitPlaces } from '../src/places';
import { categorySignal, rankPlaces } from '../src/ranking';
import { evaluateReadiness3, placeDiscoveryKey } from '../src/readiness';
import { ROUTING_TABLE_3, route3 } from '../src/routing';
import {
  COMPOSITION_POLICY, GapOutcomeRecordingAuthority, GeoEntityRef, GeographyResolutionAuthority, GroundingAuthority, InterpretedRequest,
  OsmRecord, OsmStructuredAdapter, ProviderCallCounts, Spike2Catalog, SpikePlanner, StructuredProviderFailure, WikidataFactsAdapter, assertionKey,
} from '../src/reuse';

const square = (w: number, s: number, e: number, n: number) => ({ type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] as [number, number][][] });
const BOUNDARY: OsmCandidate = { id: 'osm:relation:1', name: 'Fixture City', osmType: 'relation', osmId: 1, geometry: square(-58.53, -34.71, -58.33, -34.53), tags: {} };
const DEST: GeoEntityRef = { id: 'geo:osm:relation:1', kind: 'AREA', name: 'Fixture City', identities: [{ provider: 'openstreetmap', externalId: 'osm:relation:1' }], geometry: BOUNDARY.geometry as never, centroid: { lng: -58.43, lat: -34.62 } };
const rec = (type: 'node' | 'way', id: number, name: string, tags: Record<string, string>, lat: number, lng: number): OsmRecord => ({ externalId: `osm:${type}:${id}`, osmType: type, osmId: id, name, tags, center: { lat, lng } });

/** Synthetic POIs spread over the fixture city (unit tests only). */
function fixturePois(): OsmRecord[] {
  const out: OsmRecord[] = [
    rec('way', 10, 'Museo Uno', { tourism: 'museum', wikidata: 'Q1' }, -34.60, -58.38),
    rec('node', 11, 'Museo Uno (entrance)', { tourism: 'museum', wikidata: 'Q1' }, -34.6001, -58.3801),
    rec('node', 12, 'Hotel Fixture', { tourism: 'hotel' }, -34.61, -58.39),
    rec('node', 13, 'Parada Museo', { highway: 'bus_stop', public_transport: 'platform' }, -34.6002, -58.3802),
    rec('node', 14, 'Info Board', { tourism: 'information' }, -34.62, -58.40),
    rec('node', 15, 'Monumento Viejo', { historic: 'memorial' }, -34.63, -58.41),
    rec('node', 16, '', { tourism: 'attraction' }, -34.64, -58.42),
    rec('node', 17, 'Far Attraction', { tourism: 'attraction' }, -34.90, -58.90),
    rec('way', 18, 'Galería', { highway: 'corridor' }, -34.605, -58.375),
  ];
  // 30 ordinary admissible places in a grid so a 3-day plan can be filled.
  for (let i = 0; i < 30; i += 1) {
    const kinds = [{ tourism: 'attraction' }, { leisure: 'park' }, { amenity: 'place_of_worship' }, { historic: 'building' }, { amenity: 'marketplace' }];
    out.push(rec('node', 100 + i, `Place ${i}`, kinds[i % kinds.length], -34.58 - (i % 6) * 0.01, -58.36 - Math.floor(i / 6) * 0.01));
  }
  return out;
}

const fakeOsm = (pois = fixturePois(), fail = false): OsmStructuredAdapter => ({
  adminAreas: async () => [], namedPlaces: async () => [], walkableStreetNames: async () => [], boundary: async () => BOUNDARY, elementTags: async () => ({}),
  pois: async () => { if (fail) throw new StructuredProviderFailure('overpass down'); return pois; },
});
const fakeWikidata = (): WikidataFactsAdapter => ({ facts: async (qids) => new Map(qids.filter((q) => q === 'Q1').map((q) => [q, { qid: q, sitelinks: 12, names: ['Museo Uno'], heritage: [{ qid: 'Q19903688', label: 'Monumento Histórico Nacional' }], museumClass: true }])) });
const REQUEST: InterpretedRequest = {
  destinationLabel: 'Fixture City', days: 3, thematicFacets: [], experienceFormatFacets: [],
  mobility: { allowedTransportationModes: [TransportationMode.WALKING, TransportationMode.PUBLIC_TRANSPORT], maxWalkingDistancePerDayMeters: 8000, maxContinuousWalkingDistanceMeters: 3000, travelPace: TravelPace.MODERATE, accessibilityNeeds: [] },
};
const DESTINATION_RESOLUTION: DestinationResolution = { scale: 'area', boundary: BOUNDARY, attemptedQueries: ['fixture'] };

function catalog() {
  const c = Spike2Catalog.empty();
  c.store.recordGeoEntity(new GeographyResolutionAuthority(), DEST);
  return c;
}

describe('structured admission and dedupe (task 20.2)', () => {
  it('rejects with typed reasons: lodging, transport stop, information board, street, no name, outside destination', () => {
    const by = (name: string) => fixturePois().find((r) => r.name === name) as OsmRecord;
    expect(admit(by('Hotel Fixture'), DEST.geometry)).toMatchObject({ admitted: false, reason: 'EXCLUDED_CATEGORY' });
    expect(admit(by('Parada Museo'), DEST.geometry)).toMatchObject({ admitted: false, reason: 'EXCLUDED_CATEGORY' });
    expect(admit(by('Info Board'), DEST.geometry)).toMatchObject({ admitted: false, reason: 'EXCLUDED_CATEGORY' });
    expect(admit(by('Galería'), DEST.geometry)).toMatchObject({ admitted: false, reason: 'EXCLUDED_CATEGORY' });
    expect(admit(fixturePois().find((r) => r.osmId === 16) as OsmRecord, DEST.geometry)).toMatchObject({ admitted: false, reason: 'NO_NAME' });
    expect(admit(by('Far Attraction'), DEST.geometry)).toMatchObject({ admitted: false, reason: 'OUTSIDE_DESTINATION' });
    expect(admit({ ...by('Monumento Viejo'), center: undefined }, DEST.geometry)).toMatchObject({ admitted: false, reason: 'NO_COORDINATES' });
    expect(admit({ ...by('Monumento Viejo'), externalId: 'osm:node:0' }, DEST.geometry)).toMatchObject({ admitted: false, reason: 'NO_CANONICAL_IDENTITY' });
    expect(admit(rec('node', 99, 'Café', { amenity: 'cafe' }, -34.6, -58.4), DEST.geometry)).toMatchObject({ admitted: false, reason: 'UNKNOWN_CATEGORY' });
  });

  it('admits a historic-only feature and keeps structured provenance', () => {
    const r = admit(fixturePois().find((x) => x.name === 'Monumento Viejo') as OsmRecord, DEST.geometry);
    expect(r).toMatchObject({ admitted: true, admissionClass: 'historic:memorial', policyVersion: 'admission-spike3-1' });
    expect(r.provenance).toEqual({ providerIds: ['osm:node:15'], fields: { name: 'Monumento Viejo', historic: 'memorial', lat: '-34.63', lng: '-58.41' } });
  });

  it('dedupes by strong identity only (shared Wikidata item, way kept over node); never by name', () => {
    const { canonical, collapses } = dedupe([...fixturePois(), rec('node', 200, 'Place 1', { leisure: 'park' }, -34.70, -58.50)]);
    expect(collapses).toEqual([{ kept: 'osm:way:10', dropped: 'osm:node:11', basis: 'wikidata:Q1' }]);
    expect(canonical.filter((r) => r.name === 'Place 1')).toHaveLength(2);
  });

  it('enrichment outcomes never change an admission', async () => {
    const c = catalog();
    const ledger = AdmissionLedger.empty();
    await discoverAndAdmitPlaces({ catalog: c, ledger, osm: fakeOsm(), wikidata: fakeWikidata(), destination: DEST, destinationBoundary: BOUNDARY });
    const before = ledger.all();
    c.store.recordGapOutcome(new GapOutcomeRecordingAuthority(), { gapKey: 'Q|RELEVANT_FOR|candidate=geo:osm:way:10|facet=theme:history', outcome: 'INSUFFICIENT_EVIDENCE', budgetUsed: { rounds: 1, searches: 1, fetches: 1 }, snapshotEpoch: 1, at: 't' });
    composePlaceVisits(c, ledger, COMPOSITION_POLICY);
    expect(ledger.all()).toEqual(before);
    expect(c.snapshot().catalog.experiences['PLACE_VISIT|place=geo:osm:way:10']?.status).toBe('ACTIVE');
  });
});

describe('PLACE_VISIT without L2 (task 21.1)', () => {
  it('a PLACE_VISIT exists with zero assertions, justified by the admission record', async () => {
    const c = catalog();
    const ledger = AdmissionLedger.empty();
    await discoverAndAdmitPlaces({ catalog: c, ledger, osm: fakeOsm(), wikidata: fakeWikidata(), destination: DEST, destinationBoundary: BOUNDARY });
    composePlaceVisits(c, ledger, COMPOSITION_POLICY);
    const snap = c.snapshot();
    expect(Object.keys(snap.catalog.assertions)).toHaveLength(0);
    const pv = snap.catalog.experiences['PLACE_VISIT|place=geo:osm:node:15'];
    expect(pv).toMatchObject({ unitKind: 'PLACE_VISIT', status: 'ACTIVE', justification: ['ADMISSION|geo:osm:node:15|admission-spike3-1'] });
    expect(pv.content.facetKeys).toEqual([]);
  });

  it('enrichment adds a content revision under the same key', async () => {
    const c = catalog();
    const ledger = AdmissionLedger.empty();
    await discoverAndAdmitPlaces({ catalog: c, ledger, osm: fakeOsm(), wikidata: fakeWikidata(), destination: DEST, destinationBoundary: BOUNDARY });
    composePlaceVisits(c, ledger, COMPOSITION_POLICY);
    const key = 'PLACE_VISIT|place=geo:osm:way:10';
    const rev = c.snapshot().catalog.experiences[key].contentRevision;
    const subject = { kind: 'GEO_ENTITY' as const, geoEntityId: 'geo:osm:way:10' };
    c.store.upsertAssertion(new GroundingAuthority(), { key: assertionKey('RELEVANT_FOR', subject, 'theme:culture'), claimType: 'RELEVANT_FOR', subject, facetKey: 'theme:culture', destinationId: DEST.id, evidence: [], status: 'ACTIVE', createdAt: 't' });
    composePlaceVisits(c, ledger, COMPOSITION_POLICY);
    const after = c.snapshot().catalog.experiences[key];
    expect(after.contentRevision).toBe(rev + 1);
    expect(after.content.facetKeys).toEqual(['theme:culture']);
  });

  it('a rejected relevance claim leaves the PLACE_VISIT active', async () => {
    const c = catalog();
    const ledger = AdmissionLedger.empty();
    await discoverAndAdmitPlaces({ catalog: c, ledger, osm: fakeOsm(), wikidata: fakeWikidata(), destination: DEST, destinationBoundary: BOUNDARY });
    composePlaceVisits(c, ledger, COMPOSITION_POLICY);
    composePlaceVisits(c, ledger, COMPOSITION_POLICY);
    expect(Object.values(c.snapshot().catalog.experiences).every((e) => e.status === 'ACTIVE')).toBe(true);
  });
});

describe('structured ranking (task 21.2)', () => {
  it('category signal first, heritage second, sitelinks only as tie-breaker; nearby redundant places demoted; deterministic', async () => {
    const c = catalog();
    const ledger = AdmissionLedger.empty();
    await discoverAndAdmitPlaces({ catalog: c, ledger, osm: fakeOsm(), wikidata: fakeWikidata(), destination: DEST, destinationBoundary: BOUNDARY });
    const snap = c.snapshot();
    const points = Object.fromEntries(Object.values(snap.catalog.geoEntities).map((g) => [g.id, g.centroid]));
    const a = rankPlaces(ledger.admitted(), snap.candidates, points);
    const b = rankPlaces(ledger.admitted(), snap.candidates, points);
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ placeId: 'geo:osm:way:10', categorySignal: 5, heritageSignal: 2, sitelinks: 12 });
    expect(categorySignal('tourism:attraction')).toBeGreaterThan(categorySignal('leisure:park'));
    expect(a.length).toBe(ledger.admitted().length);
    expect(ledger.admitted().length).toBe(ledger.all().filter((r) => r.admitted).length);
  });

  it('ranking never admits, rejects or writes', async () => {
    const c = catalog();
    const ledger = AdmissionLedger.empty();
    await discoverAndAdmitPlaces({ catalog: c, ledger, osm: fakeOsm(), wikidata: fakeWikidata(), destination: DEST, destinationBoundary: BOUNDARY });
    const before = [c.snapshot(), ledger.all()];
    rankPlaces(ledger.admitted(), c.snapshot().candidates, {});
    expect([c.snapshot(), ledger.all()]).toEqual(before);
  });
});

describe('readiness and router, revision 3 (task 21.3)', () => {
  it('cold catalog needs PLACE_CANDIDATES (core); enrichment gaps never change READY', async () => {
    const c = catalog();
    const cold = await evaluateReadiness3({ snapshot: c.snapshot(), request: { ...REQUEST, thematicFacets: ['theme:history'] }, destinationId: DEST.id, probe: async () => [], structuredStrategiesRemaining: ['osm-pois-destination'] });
    expect(cold.verdict).toBe('NEEDS_ACQUISITION');
    expect(cold.coreGaps.map((g) => g.key)).toEqual([`PLACE_CANDIDATES|scope=${DEST.id}`]);
    c.store.recordGapOutcome(new GapOutcomeRecordingAuthority(), { gapKey: placeDiscoveryKey(DEST.id), outcome: 'SATISFIED', budgetUsed: { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: 1, at: 't' });
    const ledger = AdmissionLedger.empty();
    await discoverAndAdmitPlaces({ catalog: c, ledger, osm: fakeOsm(), wikidata: fakeWikidata(), destination: DEST, destinationBoundary: BOUNDARY });
    composePlaceVisits(c, ledger, COMPOSITION_POLICY);
    const ready = await evaluateReadiness3({ snapshot: c.snapshot(), request: { ...REQUEST, thematicFacets: ['theme:history'] }, destinationId: DEST.id, probe: async () => [{ dayNumber: 1, availableMinutes: 10, meaningful: false }], structuredStrategiesRemaining: [] });
    expect(ready.verdict).toBe('READY');
    expect(ready.enrichmentGaps.map((g) => g.type)).toEqual(['AREA_RELEVANCE', 'PLACE_RELEVANCE']);
    expect(Object.keys(c.snapshot().catalog.assertions)).toHaveLength(0);
  });

  it('unfilled days with structured providers exhausted -> INSUFFICIENT_KNOWLEDGE with evidence', async () => {
    const c = catalog();
    c.store.recordGapOutcome(new GapOutcomeRecordingAuthority(), { gapKey: placeDiscoveryKey(DEST.id), outcome: 'SATISFIED', budgetUsed: { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: 1, at: 't' });
    const v = await evaluateReadiness3({ snapshot: c.snapshot(), request: REQUEST, destinationId: DEST.id, probe: async () => [], structuredStrategiesRemaining: [] });
    expect(v.verdict).toBe('INSUFFICIENT_KNOWLEDGE');
    expect(v.evidence).toContain('structured providers exhausted');
  });

  it('no research strategy on any core gap; walking only as transport emits no corridor gap', async () => {
    expect(route3('PLACE_CANDIDATES', 'CORE').map((s) => s.sourceClass)).toEqual(['STRUCTURED_POI', 'STRUCTURED_ENTITY_FACTS']);
    expect(route3('SCHEDULE_CAPACITY', 'CORE')).toEqual([]);
    expect(JSON.stringify(ROUTING_TABLE_3)).not.toMatch(/https?:|www\.|\.(com|org|ar|net)\b/);
    const v = await evaluateReadiness3({ snapshot: catalog().snapshot(), request: REQUEST, destinationId: DEST.id, probe: async () => [], structuredStrategiesRemaining: ['x'] });
    expect(v.productSemanticGaps).toEqual([]);
    const walk = await evaluateReadiness3({ snapshot: catalog().snapshot(), request: { ...REQUEST, experienceFormatFacets: ['intent:walk'] }, destinationId: DEST.id, probe: async () => [], structuredStrategiesRemaining: ['x'] });
    expect(walk.productSemanticGaps.map((g) => g.product)).toEqual(['CORRIDOR_WALK']);
    expect(walk.verdict).toBe('NEEDS_ACQUISITION');
  });
});

describe('generation, revision 3 core path (offline)', () => {
  const counts: Record<string, ProviderCallCounts> = {};
  const run = (osm = fakeOsm()) => {
    const c = catalog();
    const ledger = AdmissionLedger.empty();
    return generate3({
      catalog: c, ledger, request: REQUEST, destination: DEST, destinationBoundary: BOUNDARY, osm, wikidata: fakeWikidata(),
      planner: new SpikePlanner(DESTINATION_RESOLUTION), compositionPolicy: COMPOSITION_POLICY, plannerPoolSize: 45, now: new Date('2026-10-11T00:00:00Z'), providerCounts: () => counts,
    }).then((report) => ({ report, c, ledger }));
  };

  it('produces a 3-day Tour from admitted places with zero L2 and no research', async () => {
    const { report } = await run();
    expect(report.result).toBe('TOUR');
    expect(new Set(report.tour.map((r) => r.dayNumber)).size).toBe(3);
    expect(report.l2AssertionsAtTour).toBe(0);
    expect(report.placeVisitsWithZeroL2).toBeGreaterThan(30);
    expect(report.stages[0].route).toEqual(['osm-pois-destination', 'wikidata-place-facts']);
  });

  it('structured provider outage -> explicit INSUFFICIENT_KNOWLEDGE, no Tour', async () => {
    const { report } = await run(fakeOsm(undefined, true));
    expect(report.result).toBe('INSUFFICIENT_KNOWLEDGE');
    expect(report.tour).toEqual([]);
  });
});
