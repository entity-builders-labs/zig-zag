import { NominatimApiService } from '../../../be/src/modules/integrations/osm/services/nominatim-api.service';
import { OsmCandidate, OsmPlacesService } from '../../../be/src/modules/integrations/osm/services/osm-places.service';
import { TargetedRouteResolverService } from '../../../be/src/modules/tours/services/targeted-route-resolver.service';
import { EvidenceCapture, ResearchOutcome } from '../src/contracts';
import { classifyGapOutcome, recordGapOutcome } from '../src/grounding/gap-outcome';
import { groundClaims, isGeographicDataCapture, sufficiency } from '../src/grounding/ground';
import { OsmGeoResolver } from '../src/grounding/identity';
import { publisherOf, verifyProvenance } from '../src/grounding/provenance';
import { READINESS_POLICY } from '../src/policy';
import { documentFromHtml } from '../src/research/documents';
import { DOCS, URLS, cap, claimOf, deps, fakeResolver, fakeTools, fakeVerifier, gapOf } from './fixtures/grounding-fakes';
import { DEST_ID, ENTITIES, REQUEST_A, worldStore } from './fixtures/world';

const EDITORIAL_AREA = "San Telmo is Buenos Aires' oldest barrio and the best place to understand the city’s colonial history.";
const EDITORIAL_WALK = 'Walk down Calle Defensa from Plaza de Mayo to Parque Lezama, passing antique shops and Plaza Dorrego.';
const BLOG_WALK = 'On Sundays we walked along Defensa from Plaza de Mayo to Parque Lezama, the classic San Telmo walk.';
const BLOG_AREA = 'San Telmo is full of history, cobbled streets and old colonial houses.';
const GOV_SIZE = 'San Telmo es uno de los 48 barrios de la Ciudad y tiene una superficie de 1,2 km2.';
const PASSING = 'The Mercado de San Telmo, built in 1897, is a covered market full of food stalls and antiques.';

const baseStore = () => worldStore([DEST_ID, 'geo-recoleta']);

describe('provenance and support verification (task 5.1)', () => {
  it('records REPRODUCIBLE, PUBLISHER_ESTABLISHED (JSON-LD url matches host) and drift', async () => {
    const drifted = { ...DOCS[URLS.editorial], fingerprint: 'changed' };
    const check = await verifyProvenance(cap(URLS.editorial, EDITORIAL_AREA), fakeTools({ [URLS.editorial]: drifted }));
    expect(check.status).toBe('VERIFIED');
    expect(check.capture.provenanceSignals).toEqual([
      expect.objectContaining({ kind: 'REPRODUCIBLE', fingerprintDrift: true }),
      { kind: 'PUBLISHER_ESTABLISHED', publisher: 'Fixture Travel Guide', basis: 'JSON_LD_ORGANIZATION_URL_MATCHES_HOST', registrableDomain: 'fixture-guide.example' },
    ]);
  });

  it('a page without publisher metadata is reproducible but has no established publisher; government hosting is only a signal', async () => {
    const blog = await verifyProvenance(cap(URLS.blog, BLOG_AREA), fakeTools());
    expect(blog.capture.provenanceSignals.map((s) => s.kind)).toEqual(['REPRODUCIBLE']);
    const gov = await verifyProvenance(cap(URLS.gov, GOV_SIZE), fakeTools());
    expect(gov.capture.provenanceSignals.map((s) => s.kind)).toEqual(['REPRODUCIBLE', 'GOVERNMENT_HOSTED']);
    expect(publisherOf(blog.capture)).toBe('domain:blog-host.example');
  });

  it('rejects EVIDENCE_NOT_REPRODUCIBLE when the span is absent from the re-fetched page', async () => {
    const store = baseStore();
    const changed = documentFromHtml(URLS.editorial, '<html><body><p>Page rewritten.</p></body></html>', '2026-10-11T00:00:00Z');
    const [r] = await groundClaims(deps(store, fakeTools({ [URLS.editorial]: changed })), gapOf('AREA_RELEVANCE'), [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', captures: [cap(URLS.editorial, EDITORIAL_AREA)] }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'EVIDENCE_NOT_REPRODUCIBLE' });
  });

  it('rejects EVIDENCE_DOES_NOT_SUPPORT_CLAIM when the verifier finds no support', async () => {
    const [r] = await groundClaims(deps(baseStore(), fakeTools(), fakeResolver(), fakeVerifier(() => 'NONE')), gapOf('AREA_RELEVANCE'), [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', captures: [cap(URLS.editorial, EDITORIAL_AREA)] }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM' });
  });

  it('a verified publisher with a passing mention does not support the claim', async () => {
    const store = worldStore([DEST_ID, 'geo-san-telmo']);
    const verifier = fakeVerifier((statement, text) => (text.includes('covered market') && statement.includes('history') ? 'NONE' : 'EXPLICIT'));
    const [r] = await groundClaims(deps(store, fakeTools(), fakeResolver(), verifier), gapOf('NOTABLE_PLACES', 'geo-san-telmo'), [
      claimOf({ claimType: 'NOTABLE_WITHIN', subjectMention: 'Mercado de San Telmo', areaMention: 'San Telmo', captures: [cap(URLS.editorial, PASSING)] }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM' });
    expect(Object.keys(store.snapshot().assertions)).toHaveLength(0);
  });
});

describe('identity resolution (task 5.2)', () => {
  it('rejects IDENTITY_AMBIGUOUS without choosing an entity', async () => {
    const store = baseStore();
    const resolver = fakeResolver({ 'san telmo': { status: 'AMBIGUOUS', detail: 'two neighbourhoods' } });
    const [r] = await groundClaims(deps(store, fakeTools(), resolver), gapOf('AREA_RELEVANCE'), [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', captures: [cap(URLS.editorial, EDITORIAL_AREA)] }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'IDENTITY_AMBIGUOUS' });
    expect(store.snapshot().geoEntities['geo-san-telmo']).toBeUndefined();
  });

  it('reports RESOLUTION_UNAVAILABLE as a failure, not a rejection', async () => {
    const resolver = fakeResolver({ 'san telmo': { status: 'UNAVAILABLE', detail: 'overpass down' } });
    const [r] = await groundClaims(deps(baseStore(), fakeTools(), resolver), gapOf('AREA_RELEVANCE'), [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', captures: [cap(URLS.editorial, EDITORIAL_AREA)] }),
    ]);
    expect(r).toMatchObject({ status: 'FAILED', reason: 'RESOLUTION_UNAVAILABLE' });
  });

  it('records a newly resolved entity in L1 through the resolution authority before the assertion', async () => {
    const store = baseStore();
    const [r] = await groundClaims(deps(store), gapOf('AREA_RELEVANCE'), [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', captures: [cap(URLS.editorial, EDITORIAL_AREA)] }),
    ]);
    expect(r.status).toBe('AUTHORIZED');
    const snapshot = store.snapshot();
    expect(snapshot.geoEntities['geo-san-telmo']).toBeDefined();
    expect(Object.values(snapshot.assertions)[0].subject).toEqual({ kind: 'GEO_ENTITY', geoEntityId: 'geo-san-telmo' });
  });

  describe('OsmGeoResolver over the backend IdentityVerifier', () => {
    const boundary = (id: string, name: string, west: number, south: number, east: number, north: number): OsmCandidate => ({
      id, name, osmType: 'relation', osmId: Number(id.replace(/\D/g, '')) || 1, tags: { admin_level: '10' },
      geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
    });
    const caba = boundary('osm:relation:1', 'Ciudad Autónoma de Buenos Aires', -58.53, -34.71, -58.33, -34.53);
    const destination = ENTITIES[DEST_ID];
    const make = (neighbourhoods: OsmCandidate[], nominatim: unknown[] = [], routeResult: unknown = undefined, polygons: Record<number, OsmCandidate> = {}) =>
      new OsmGeoResolver(
        {
          lookupNeighborhoodsWithin: async () => ({ status: 'success', value: neighbourhoods.map((n) => ({ ...n, geometry: { type: 'Point', coordinates: [0, 0] } })) }),
          lookupBoundaryById: async (_t: string, id: number) => ({ status: 'success', value: neighbourhoods.find((n) => n.osmId === id) ?? polygons[id] ?? null }),
        } as unknown as OsmPlacesService,
        { search: async () => nominatim } as unknown as NominatimApiService,
        { resolve: async () => routeResult } as unknown as TargetedRouteResolverService,
        caba,
        'ar',
      );

    it('resolves a unique neighbourhood name (GROUNDED_UNIQUE_EXACT_NAME) and flags duplicates as ambiguous', async () => {
      const st = boundary('osm:relation:2', 'San Telmo', -58.38, -34.628, -58.365, -34.612);
      const ok = await make([st, boundary('osm:relation:3', 'Recoleta', -58.405, -34.595, -58.38, -34.58)]).resolveArea('Barrio de San Telmo', { destination });
      expect(ok).toMatchObject({ status: 'RESOLVED', rule: 'GROUNDED_UNIQUE_EXACT_NAME' });
      const dup = await make([st, { ...st, id: 'osm:relation:9', osmId: 9 }]).resolveArea('San Telmo', { destination });
      expect(dup.status).toBe('AMBIGUOUS');
    });

    it('ignores a homonym outside the destination and needs area correspondence to verify a place', async () => {
      const results = [
        { osmType: 'way', osmId: 298351142, addresstype: 'park', displayName: 'Plaza Dorrego, Las Nieves, González Catán, La Matanza', importance: 0.08, latitude: -34.773, longitude: -58.614 },
        { osmType: 'way', osmId: 111, addresstype: 'park', displayName: 'Plaza Dorrego, San Telmo, Buenos Aires', importance: 0.2, latitude: -34.6206, longitude: -58.3716 },
      ];
      const area = ENTITIES['geo-san-telmo'];
      const withArea = await make([], results).resolvePlace('Plaza Dorrego', { destination, area, areaNamedBySource: true });
      expect(withArea).toMatchObject({ status: 'RESOLVED', rule: 'GROUNDED_UNIQUE_EXACT_NAME' });
      if (withArea.status === 'RESOLVED') expect(withArea.entity.identities).toEqual([{ provider: 'openstreetmap', externalId: 'osm:way:111' }]);
      const destinationOnly = await make([], results).resolvePlace('Plaza Dorrego', { destination });
      expect(destinationOnly.status).not.toBe('RESOLVED');
    });

    it('hydrates the neighbourhood polygon (the pool only carries centers)', async () => {
      const st = boundary('osm:relation:2', 'San Telmo', -58.38, -34.628, -58.365, -34.612);
      const r = await make([st]).resolveArea('San Telmo', { destination });
      expect(r.status === 'RESOLVED' && r.entity.geometry.type).toBe('Polygon');
    });

    it('excludes transit stops named after a landmark and verifies a park touching the source-named street', async () => {
      const park = boundary('osm:way:17441757', 'Parque Lezama', -58.371, -34.6285, -58.3675, -34.6253);
      const results = [
        { osmType: 'way', osmId: 17441757, class: 'leisure', type: 'park', addresstype: 'park', displayName: 'Parque Lezama, San Telmo', importance: 0.3, latitude: -34.6271, longitude: -58.3693 },
        { osmType: 'node', osmId: 10910591117, class: 'highway', type: 'bus_stop', addresstype: 'highway', displayName: 'Parque Lezama, Metrobus del Bajo', importance: 0.1, latitude: -34.6259, longitude: -58.3678 },
        { osmType: 'node', osmId: 11093258763, class: 'highway', type: 'bus_stop', addresstype: 'highway', displayName: 'Parque Lezama, Defensa', importance: 0.1, latitude: -34.6257, longitude: -58.3710 },
      ];
      const nearRoute = { vertices: [{ lng: -58.3714, lat: -34.6200 }, { lng: -58.3712, lat: -34.6254 }], toleranceMeters: 120 };
      const cityOnly = await make([], results, undefined, { 17441757: park }).resolvePlace('Parque Lezama', { destination });
      expect(cityOnly.status).not.toBe('RESOLVED');
      const onRoute = await make([], results, undefined, { 17441757: park }).resolvePlace('Parque Lezama', { destination, nearRoute });
      expect(onRoute).toMatchObject({ status: 'RESOLVED', rule: 'GROUNDED_UNIQUE_EXACT_NAME' });
      if (onRoute.status === 'RESOLVED') {
        expect(onRoute.entity.identities).toEqual([{ provider: 'openstreetmap', externalId: 'osm:way:17441757' }]);
        expect(onRoute.entity.geometry.type).toBe('Polygon');
      }
    });

    it('verifies a single compatible route cluster through STRUCTURED_ROUTE', async () => {
      const cluster = {
        canonicalName: 'Defensa', segmentExternalIds: ['osm:way:1', 'osm:way:2'],
        segments: [{ externalId: 'osm:way:1', highway: 'residential', lengthMeters: 400, probePoint: { latitude: -34.61, longitude: -58.372 }, coordinates: [[-58.372, -34.608], [-58.3718, -34.612]] },
          { externalId: 'osm:way:2', highway: 'residential', lengthMeters: 400, probePoint: { latitude: -34.62, longitude: -58.3716 }, coordinates: [[-58.3718, -34.612], [-58.3716, -34.62]] }],
        compatibility: { verdict: 'COMPATIBLE', reason: 'WITHIN_DESTINATION_BOUNDARY' },
      };
      const r = await make([], [], { status: 'RESOLVED', reason: 'SINGLE_COMPATIBLE_CLUSTER', clusters: [cluster], resolved: cluster, compatibleClusterCount: 1 })
        .resolveRoute('Calle Defensa', { destination });
      expect(r).toMatchObject({ status: 'RESOLVED', rule: 'STRUCTURED_ROUTE' });
      if (r.status === 'RESOLVED') expect(r.entity.identities).toHaveLength(2);
    });
  });
});

describe('geometric consistency and corridor bounds (task 5.3)', () => {
  it('rejects GEOMETRY_INCONSISTENT when a place lies outside the claimed area', async () => {
    const [r] = await groundClaims(deps(worldStore([DEST_ID])), gapOf('NOTABLE_PLACES', 'geo-recoleta'), [
      claimOf({ claimType: 'NOTABLE_WITHIN', subjectMention: 'Plaza Dorrego', areaMention: 'Recoleta', captures: [cap(URLS.editorial, EDITORIAL_WALK)] }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'GEOMETRY_INCONSISTENT' });
  });

  it('bounds Defensa by stated anchors when the evidence names both and they resolve on the street', async () => {
    const store = worldStore([DEST_ID]);
    const [r] = await groundClaims(deps(store), gapOf('WALKING_CORRIDOR', DEST_ID, 'intent:walk'), [
      claimOf({ claimType: 'WALKING_CORRIDOR', subjectMention: 'Calle Defensa', fromMention: 'Plaza de Mayo', toMention: 'Parque Lezama', captures: [cap(URLS.editorial, EDITORIAL_WALK)] }),
    ]);
    expect(r.status).toBe('AUTHORIZED');
    if (r.status !== 'AUTHORIZED') return;
    expect(r.assertions.map((a) => a.facetKey)).toEqual(['intent:walk', 'theme:history']);
    expect(r.assertions[0].subject).toEqual({
      kind: 'CORRIDOR',
      corridor: { routeGeoEntityId: 'geo-defensa', from: { kind: 'GEO_ENTITY', geoEntityId: 'geo-parque-lezama' }, to: { kind: 'GEO_ENTITY', geoEntityId: 'geo-plaza-de-mayo' }, boundKind: 'STATED_ANCHORS' },
    });
  });

  it('uses AREA_CLIP when the evidence names only the street and the area', async () => {
    const [r] = await groundClaims(deps(worldStore([DEST_ID])), gapOf('WALKING_CORRIDOR', DEST_ID, 'intent:walk'), [
      // Blog publisher is not established, so an independent capture corroborates (D8).
      claimOf({ claimType: 'WALKING_CORRIDOR', subjectMention: 'Defensa', areaMention: 'San Telmo', captures: [cap(URLS.blog, BLOG_WALK), cap(URLS.editorial, EDITORIAL_WALK)] }),
    ]);
    expect(r.status).toBe('AUTHORIZED');
    if (r.status === 'AUTHORIZED') expect(r.assertions[0].subject).toMatchObject({ kind: 'CORRIDOR', corridor: { boundKind: 'AREA_CLIP', from: { kind: 'AREA_CLIP', areaGeoEntityId: 'geo-san-telmo' } } });
  });

  it('never invents endpoints: endpoints absent from the evidence are ignored', async () => {
    const [r] = await groundClaims(deps(worldStore([DEST_ID])), gapOf('WALKING_CORRIDOR', DEST_ID, 'intent:walk'), [
      claimOf({ claimType: 'WALKING_CORRIDOR', subjectMention: 'Defensa', fromMention: 'Plaza de Mayo', toMention: 'Plaza Dorrego', captures: [cap(URLS.blog, BLOG_AREA)] }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'CORRIDOR_BOUNDS_UNRESOLVED' });
  });

  it('rejects an anchor that is not on the street', async () => {
    const [r] = await groundClaims(deps(worldStore([DEST_ID])), gapOf('WALKING_CORRIDOR', DEST_ID, 'intent:walk'), [
      claimOf({
        claimType: 'WALKING_CORRIDOR', subjectMention: 'Defensa', fromMention: 'Plaza de Mayo', toMention: 'Cementerio de la Recoleta',
        captures: [cap(URLS.blog, 'Afterwards we took a bus from Plaza de Mayo to the Cementerio de la Recoleta.'), cap(URLS.editorial, EDITORIAL_WALK)],
      }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'GEOMETRY_INCONSISTENT' });
  });
});

describe('claim authorization and sufficiency (task 5.4)', () => {
  const verified = async (url: string, quote: string, authority?: string): Promise<EvidenceCapture> =>
    (await verifyProvenance(cap(url, quote, authority), fakeTools())).capture;

  it('single capture with established publisher and EXPLICIT support is authorized', async () => {
    expect(sufficiency([{ capture: await verified(URLS.editorial, EDITORIAL_AREA), level: 'EXPLICIT' }])).toEqual({ status: 'AUTHORIZED', basis: 'SINGLE_VERIFIED_EXPLICIT' });
  });

  it('an agent-labelled "official" capture with unestablished publisher needs independent corroboration', async () => {
    const blog = await verified(URLS.blog, BLOG_AREA, 'official tourism authority');
    expect(sufficiency([{ capture: blog, level: 'EXPLICIT' }])).toEqual({ status: 'REJECTED', reason: 'INSUFFICIENT_CORROBORATION' });
    const gov = await verified(URLS.gov, 'San Telmo es el barrio más antiguo de la ciudad y concentra gran parte de su historia colonial.');
    expect(sufficiency([{ capture: blog, level: 'EXPLICIT' }, { capture: gov, level: 'IMPLICIT' }])).toEqual({ status: 'AUTHORIZED', basis: 'INDEPENDENT_CORROBORATION' });
  });

  it('a government-hosted capture without explicit support is not authorized', async () => {
    const gov = await verified(URLS.gov, GOV_SIZE);
    expect(gov.provenanceSignals.map((s) => s.kind)).toContain('GOVERNMENT_HOSTED');
    expect(sufficiency([{ capture: gov, level: 'NONE' }])).toEqual({ status: 'REJECTED', reason: 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM' });
    expect(sufficiency([{ capture: gov, level: 'IMPLICIT' }])).toEqual({ status: 'REJECTED', reason: 'INSUFFICIENT_CORROBORATION' });
  });

  it('two captures from the same publisher do not corroborate each other', async () => {
    const a = await verified(URLS.blog, BLOG_AREA);
    const b = await verified(URLS.blog, BLOG_WALK);
    expect(sufficiency([{ capture: a, level: 'EXPLICIT' }, { capture: b, level: 'EXPLICIT' }])).toEqual({ status: 'REJECTED', reason: 'INSUFFICIENT_CORROBORATION' });
  });

  it('RELEVANT_FOR citing only OSM data is rejected', async () => {
    const osm = cap(URLS.osm, 'Plaza Dorrego, a leisure=park in San Telmo, Buenos Aires.');
    expect(isGeographicDataCapture(osm)).toBe(true);
    const verifier = fakeVerifier(() => 'EXPLICIT');
    const [r] = await groundClaims(deps(worldStore([DEST_ID]), fakeTools(), fakeResolver(), verifier), gapOf('NOTABLE_PLACES', 'geo-san-telmo'), [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'Plaza Dorrego', captures: [osm] }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'EVIDENCE_DOES_NOT_SUPPORT_CLAIM' });
    expect(verifier.calls).toBe(0);
  });

  it('merges equivalent proposed claims so independent captures corroborate', async () => {
    const store = worldStore([DEST_ID]);
    const [r] = await groundClaims(deps(store), gapOf('AREA_RELEVANCE'), [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', captures: [cap(URLS.blog, BLOG_AREA, 'official')] }),
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'san telmo', captures: [cap(URLS.gov, 'San Telmo es el barrio más antiguo de la ciudad y concentra gran parte de su historia colonial.')] }),
    ]);
    expect(r.status).toBe('AUTHORIZED');
    if (r.status === 'AUTHORIZED') expect(r.assertions[0].evidence).toHaveLength(2);
  });

  it('rejects NO_CANONICAL_FACET when no theme maps to the vocabulary', async () => {
    const [r] = await groundClaims(deps(worldStore([DEST_ID])), gapOf('AREA_RELEVANCE'), [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', proposedThemes: ['bohemian vibes'], captures: [cap(URLS.editorial, EDITORIAL_AREA)] }),
    ]);
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'NO_CANONICAL_FACET' });
  });
});

describe('gap outcome recording (task 5.5)', () => {
  const research = (kind: ResearchOutcome['kind']): ResearchOutcome => ({
    gapKey: 'k', kind, claims: [], discarded: [], budgetUsed: { rounds: 3, searches: 1, fetches: 2 }, snapshotEpoch: 1,
  });

  it('all claims rejected -> INSUFFICIENT_EVIDENCE, suppressed within the freshness window', async () => {
    const store = worldStore([DEST_ID]);
    const gap = gapOf('AREA_RELEVANCE', DEST_ID, 'theme:food');
    const grounding = await groundClaims(deps(store, fakeTools(), fakeResolver(), fakeVerifier(() => 'NONE')), gap, [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', proposedThemes: ['food'], captures: [cap(URLS.editorial, EDITORIAL_AREA)] }),
    ]);
    const entry = await recordGapOutcome({
      store, gap: { ...gap, key: `AREA_RELEVANCE|scope=${DEST_ID}|facet=theme:food` }, request: REQUEST_A, destinationId: DEST_ID, policy: READINESS_POLICY,
      now: new Date('2026-10-10T12:00:00Z'), research: { ...research('CLAIMS_PROPOSED') }, grounding,
    });
    expect(entry.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(store.snapshot().ledger[entry.gapKey]).toHaveLength(1);
  });

  it('resolver or tool failure -> FAILED (not suppressed by readiness)', () => {
    expect(classifyGapOutcome(false, research('TOOL_FAILURE'), [])).toBe('FAILED');
    expect(classifyGapOutcome(false, research('CLAIMS_PROPOSED'), [{ status: 'FAILED', claim: {} as never, reason: 'RESOLUTION_UNAVAILABLE' }])).toBe('FAILED');
    expect(classifyGapOutcome(false, research('BUDGET_EXHAUSTED'), [])).toBe('BUDGET_EXHAUSTED');
  });

  it('gap no longer emitted after grounding -> SATISFIED', async () => {
    const store = worldStore([DEST_ID]);
    const gap = { ...gapOf('AREA_RELEVANCE', DEST_ID, 'theme:history'), key: `AREA_RELEVANCE|scope=${DEST_ID}|facet=theme:history` };
    const grounding = await groundClaims(deps(store), gap, [
      claimOf({ claimType: 'RELEVANT_FOR', subjectMention: 'San Telmo', captures: [cap(URLS.editorial, EDITORIAL_AREA)] }),
    ]);
    const entry = await recordGapOutcome({
      store, gap, request: REQUEST_A, destinationId: DEST_ID, policy: READINESS_POLICY, now: new Date('2026-10-10T12:00:00Z'), research: research('CLAIMS_PROPOSED'), grounding,
    });
    expect(entry.outcome).toBe('SATISFIED');
  });
});
