import { FacetRetrievalService } from './facet-retrieval.service';
import { RequestedFacet } from '../interfaces/preference-spec.interface';

function facet(overrides: Partial<RequestedFacet> = {}): RequestedFacet {
  return {
    dimension: 'theme',
    key: 'history',
    weight: 1,
    source: 'wizard',
    required: false,
    ...overrides,
  };
}

function row(overrides: Record<string, any> = {}) {
  return {
    id: 'exp-1',
    themes: ['history'],
    qualityScore: 4.4,
    durationMinutes: 90,
    components: [{ geoEntity: { latitude: -34.6, longitude: -58.38 } }],
    metadata: {},
    ...overrides,
  };
}

describe('FacetRetrievalService', () => {
  function makeService(rows: any[]) {
    const catalog = {
      findVerifiedWithin: jest.fn(async () => rows),
    } as any;
    return { service: new FacetRetrievalService(catalog), catalog };
  }

  const SCOPE = { latitude: -34.6, longitude: -58.38, radiusMeters: 5000 };

  it('buckets matching-and-strong rows into strongMatches, matching-but-not-strong rows into weakMatches, and excludes non-matching rows entirely', async () => {
    const strongRow = row({ id: 'strong-1', qualityScore: 4.5 });
    const weakRow = row({ id: 'weak-1', qualityScore: 2.0 }); // matches theme, below quality floor
    const nonMatchingRow = row({ id: 'other-1', themes: ['tango'] });

    const { service } = makeService([strongRow, weakRow, nonMatchingRow]);

    const result = await service.retrieveFacetCandidates(facet(), SCOPE);

    expect(result.strongMatches).toEqual(['strong-1']);
    expect(result.weakMatches).toEqual(['weak-1']);
    expect(result.satisfied).toBe(true);
    expect(result.facet).toEqual(facet());
  });

  it('orders both buckets strongest-first by qualityScore, with id as a deterministic tie-break', async () => {
    const a = row({ id: 'exp-b', qualityScore: 3.5 });
    const b = row({ id: 'exp-a', qualityScore: 4.8 });
    const c = row({ id: 'exp-c', qualityScore: 3.5 }); // ties with a on quality -> id tie-break

    const { service } = makeService([a, b, c]);

    const result = await service.retrieveFacetCandidates(facet(), SCOPE);

    expect(result.strongMatches).toEqual(['exp-a', 'exp-b', 'exp-c']);
  });

  it('is not satisfied when there is no strong match, even if weak matches exist', async () => {
    const weakOnly = row({ id: 'weak-only', qualityScore: 1.0 });

    const { service } = makeService([weakOnly]);

    const result = await service.retrieveFacetCandidates(facet(), SCOPE);

    expect(result.strongMatches).toEqual([]);
    expect(result.weakMatches).toEqual(['weak-only']);
    expect(result.satisfied).toBe(false);
  });

  it('requests a generously large limit from the canonical catalog boundary so a relevant row is never lost to truncation', async () => {
    const { service, catalog } = makeService([]);

    await service.retrieveFacetCandidates(facet(), SCOPE);

    expect(catalog.findVerifiedWithin).toHaveBeenCalledTimes(1);
    const [lat, lng, radius, limit] = catalog.findVerifiedWithin.mock.calls[0];
    expect(lat).toBe(SCOPE.latitude);
    expect(lng).toBe(SCOPE.longitude);
    expect(radius).toBe(SCOPE.radiusMeters);
    expect(typeof limit).toBe('number');
    expect(limit).toBeGreaterThanOrEqual(2000);
  });

  it('passes an optional strong-match policy through to strength evaluation', async () => {
    const borderline = row({ id: 'exp-1', qualityScore: 3.2 });

    const { service } = makeService([borderline]);

    const strictResult = await service.retrieveFacetCandidates(facet(), SCOPE, {
      qualityFloor: 3.5,
    });
    expect(strictResult.strongMatches).toEqual([]);

    const looseResult = await service.retrieveFacetCandidates(facet(), SCOPE, {
      qualityFloor: 3.0,
    });
    expect(looseResult.strongMatches).toEqual(['exp-1']);
  });

  it('never lets a bare/no-component row become a strong match, even when it matches the facet', async () => {
    const bare = row({ id: 'bare-1', components: [] });

    const { service } = makeService([bare]);

    const result = await service.retrieveFacetCandidates(facet(), SCOPE);

    expect(result.strongMatches).toEqual([]);
    expect(result.weakMatches).toEqual(['bare-1']);
  });
});
