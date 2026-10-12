import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Assertion, CorridorSubject, EvidenceCapture } from '../src/contracts';
import { assertionKey, corridorWalkKey, gapKey, placeVisitKey } from '../src/keys';
import { Recorder, ReplayMissError, SpikeNoopAiCache } from '../src/recording';
import {
  AuthorityViolation,
  CatalogStore,
  GapOutcomeRecordingAuthority,
  GeographyResolutionAuthority,
  GroundingAuthority,
  ReusableCompositionAuthority,
} from '../src/stores';

const capture = (url: string, text: string): EvidenceCapture => ({
  id: `${url}#${text}`,
  locator: { kind: 'URL', url },
  retrievedAt: '2026-10-10T00:00:00Z',
  contentFingerprint: 'f',
  capture: { kind: 'PROSE_SPAN', start: 0, end: text.length, text },
  provenanceSignals: [],
  supportVerdicts: [],
});

const assertion = (evidence: EvidenceCapture[]): Assertion => ({
  key: assertionKey('RELEVANT_FOR', { kind: 'GEO_ENTITY', geoEntityId: 'area-1' }, 'theme:history'),
  claimType: 'RELEVANT_FOR',
  subject: { kind: 'GEO_ENTITY', geoEntityId: 'area-1' },
  facetKey: 'theme:history',
  destinationId: 'dest',
  evidence,
  status: 'ACTIVE',
  createdAt: '2026-10-10T00:00:00Z',
});

describe('recording layer (task 2.2)', () => {
  it('replays a recorded call without invoking the underlying function', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gddk-rec-'));
    const live = jest.fn().mockResolvedValue({ ok: 1 });
    await new Recorder(dir, 'record').call('serper', 'search', { q: 'x' }, live);
    const replay = new Recorder(dir, 'replay');
    const network = jest.fn();
    await expect(replay.call('serper', 'search', { q: 'x' }, network)).resolves.toEqual({ ok: 1 });
    expect(network).not.toHaveBeenCalled();
    expect(replay.counts.serper).toEqual({ live: 0, replayed: 1, failed: 0 });
  });

  it('fails a replay miss instead of calling live', async () => {
    const replay = new Recorder(mkdtempSync(join(tmpdir(), 'gddk-rec-')), 'replay');
    const network = jest.fn();
    await expect(replay.call('osm', 'lookup', [1], network)).rejects.toBeInstanceOf(ReplayMissError);
    expect(network).not.toHaveBeenCalled();
    expect(replay.counts.osm.failed).toBe(1);
  });

  it('records failures so a replay reproduces them, and counts per provider', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gddk-rec-'));
    const rec = new Recorder(dir, 'record');
    await expect(rec.call('fetch', 'get', ['u'], () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await rec.call('llm', 'complete', ['p'], () => Promise.resolve('r'));
    expect(rec.counts).toEqual({ fetch: { live: 0, replayed: 0, failed: 1 }, llm: { live: 1, replayed: 0, failed: 0 } });
    await expect(new Recorder(dir, 'replay').call('fetch', 'get', ['u'], jest.fn())).rejects.toThrow('boom');
  });

  it('wraps service methods through the recorder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gddk-rec-'));
    const service = { search: async (q: string) => `r:${q}`, other: () => 'untouched' };
    const wrapped = new Recorder(dir, 'record').wrap(service, 'svc', ['search']);
    expect(await wrapped.search('a')).toBe('r:a');
    expect(wrapped.other()).toBe('untouched');
  });

  it('the spike AI cache never hits and never stores', async () => {
    const cache = new SpikeNoopAiCache();
    await cache.cacheResponse();
    await expect(cache.getCachedResponse()).resolves.toBeNull();
    expect(cache.isEnabled()).toBe(false);
  });
});

describe('canonical keys (task 2.3)', () => {
  const corridor: CorridorSubject = {
    routeGeoEntityId: 'route-defensa',
    from: { kind: 'GEO_ENTITY', geoEntityId: 'plaza-de-mayo' },
    to: { kind: 'GEO_ENTITY', geoEntityId: 'parque-lezama' },
    boundKind: 'STATED_ANCHORS',
  };

  it('corridor keys are independent of the order the bounds are stated in', () => {
    const reversed: CorridorSubject = { ...corridor, from: corridor.to, to: corridor.from };
    expect(corridorWalkKey(reversed)).toBe(corridorWalkKey(corridor));
    expect(assertionKey('WALKING_CORRIDOR', { kind: 'CORRIDOR', corridor: reversed }, 'intent:walk')).toBe(
      assertionKey('WALKING_CORRIDOR', { kind: 'CORRIDOR', corridor }, 'intent:walk'),
    );
  });

  it('gap keys are stable across facet ordering and duplicates', () => {
    expect(gapKey('SCHEDULE_CAPACITY', 'ba', ['theme:food', 'theme:history', 'theme:food'])).toBe(
      gapKey('SCHEDULE_CAPACITY', 'ba', ['theme:history', 'theme:food']),
    );
  });

  it('keys contain only declared anchors (no user/score/day/neighbour/policy fields)', () => {
    const key = corridorWalkKey(corridor);
    expect(key).toBe('CORRIDOR_WALK|route=route-defensa|from=geo:parque-lezama|to=geo:plaza-de-mayo');
    expect(placeVisitKey('p1')).toBe('PLACE_VISIT|place=p1');
    for (const forbidden of ['user', 'score', 'day', 'policy', 'neighbour', 'rank']) {
      expect(key).not.toContain(forbidden);
    }
  });

  it('area-clip bounds produce a distinct, stable key', () => {
    const clip: CorridorSubject = {
      routeGeoEntityId: 'route-defensa',
      from: { kind: 'AREA_CLIP', areaGeoEntityId: 'san-telmo' },
      to: { kind: 'AREA_CLIP', areaGeoEntityId: 'san-telmo' },
      boundKind: 'AREA_CLIP',
    };
    expect(corridorWalkKey(clip)).toBe('CORRIDOR_WALK|route=route-defensa|from=area:san-telmo|to=area:san-telmo');
    expect(corridorWalkKey(clip)).not.toBe(corridorWalkKey(corridor));
  });
});

describe('authority-typed stores (task 2.4)', () => {
  it('rejects a write without the layer authority token', () => {
    const store = new CatalogStore();
    const wrong = new GroundingAuthority() as unknown as GeographyResolutionAuthority;
    expect(() =>
      store.recordGeoEntity(wrong, {
        id: 'g', kind: 'PLACE', name: 'x', identities: [{ provider: 'osm', externalId: 'osm:node:1' }],
        geometry: { type: 'Point', coordinates: [0, 0] }, centroid: { lng: 0, lat: 0 },
      }),
    ).toThrow(AuthorityViolation);
    expect(() => store.upsertAssertion(new ReusableCompositionAuthority() as unknown as GroundingAuthority, assertion([]))).toThrow(AuthorityViolation);
    expect(() =>
      store.recordGapOutcome(new GroundingAuthority() as unknown as GapOutcomeRecordingAuthority, {
        gapKey: 'k', outcome: 'SATISFIED', budgetUsed: { rounds: 0, searches: 0, fetches: 0 }, snapshotEpoch: 0, at: 'now',
      }),
    ).toThrow(AuthorityViolation);
  });

  it('rejects an L1 entity without provider identity', () => {
    const store = new CatalogStore();
    expect(() =>
      store.recordGeoEntity(new GeographyResolutionAuthority(), {
        id: 'g', kind: 'PLACE', name: 'x', identities: [], geometry: { type: 'Point', coordinates: [0, 0] }, centroid: { lng: 0, lat: 0 },
      }),
    ).toThrow(AuthorityViolation);
  });

  it('merges evidence for an equivalent claim instead of creating a parallel assertion', () => {
    const store = new CatalogStore();
    const token = new GroundingAuthority();
    expect(store.upsertAssertion(token, assertion([capture('https://a.example/x', 'San Telmo is historic')]))).toBe('CREATED');
    expect(store.upsertAssertion(token, assertion([capture('https://b.example/y', 'historic San Telmo')]))).toBe('EVIDENCE_MERGED');
    expect(store.upsertAssertion(token, assertion([capture('https://b.example/y', 'historic  San Telmo')]))).toBe('UNCHANGED');
    const snapshot = store.snapshot();
    expect(Object.keys(snapshot.assertions)).toHaveLength(1);
    expect(Object.values(snapshot.assertions)[0].evidence).toHaveLength(2);
  });

  it('reuses an L1 entity that shares a provider identity', () => {
    const store = new CatalogStore();
    const token = new GeographyResolutionAuthority();
    const base = { kind: 'PLACE' as const, name: 'x', geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] }, centroid: { lng: 0, lat: 0 } };
    store.recordGeoEntity(token, { ...base, id: 'g1', identities: [{ provider: 'osm', externalId: 'osm:node:1' }] });
    const second = store.recordGeoEntity(token, { ...base, id: 'g2', identities: [{ provider: 'osm', externalId: 'osm:node:1' }] });
    expect(second.id).toBe('g1');
    expect(Object.keys(store.snapshot().geoEntities)).toEqual(['g1']);
  });

  it('snapshots are isolated copies carrying the epoch', () => {
    const store = new CatalogStore();
    const before = store.snapshot();
    store.upsertAssertion(new GroundingAuthority(), assertion([capture('https://a.example', 't')]));
    expect(before.epoch).toBe(0);
    expect(Object.keys(before.assertions)).toHaveLength(0);
    expect(store.epoch).toBe(1);
  });
});
