import { GeographicScope } from '../interfaces/experience-resolution.interface';
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
      findVerifiedWithinForMatching: jest.fn(async () => rows),
    } as any;
    return { service: new FacetRetrievalService(catalog), catalog };
  }

  // The destination polygon the retrieval window was derived from: rows
  // are tour-eligible only when their components lie WITHIN it (PD1).
  const DESTINATION: GeographicScope = {
    kind: 'AREA_BOUNDARY',
    boundary: {
      id: 'osm:relation:1',
      name: 'Fixture City',
      osmType: 'relation',
      osmId: 1,
      tags: { admin_level: '8' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.45, -34.65],
            [-58.3, -34.65],
            [-58.3, -34.55],
            [-58.45, -34.55],
            [-58.45, -34.65],
          ],
        ],
      },
    },
  };
  const SCOPE = {
    latitude: -34.6,
    longitude: -58.38,
    radiusMeters: 5000,
    destination: DESTINATION,
  };

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

  it('retrieves from the canonical PostGIS-backed catalog boundary with no result-limit argument at all', async () => {
    const { service, catalog } = makeService([]);

    await service.retrieveFacetCandidates(facet(), SCOPE);

    expect(catalog.findVerifiedWithinForMatching).toHaveBeenCalledTimes(1);
    expect(catalog.findVerifiedWithinForMatching).toHaveBeenCalledWith(
      SCOPE.latitude,
      SCOPE.longitude,
      SCOPE.radiusMeters,
    );
    // Task A6.1: no FACET_RETRIEVAL_LIMIT / no fourth (limit) argument --
    // findVerifiedWithinForMatching itself has no correctness-visible cap.
    expect(catalog.findVerifiedWithinForMatching.mock.calls[0]).toHaveLength(3);
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

  it('never lets a bare/no-component row match at all: its destination relation is UNKNOWN, never WITHIN (PD1)', async () => {
    const bare = row({ id: 'bare-1', components: [] });

    const { service } = makeService([bare]);

    const result = await service.retrieveFacetCandidates(facet(), SCOPE);

    expect(result.strongMatches).toEqual([]);
    expect(result.weakMatches).toEqual([]);
  });

  describe('quality ordering hardening (Task A6.1 review fix)', () => {
    // A quality floor above the one valid score makes every row a weak
    // match regardless of qualityScore -- isolating this test to ordering
    // only, never strong/weak classification.
    it('never lets a corrupt/invalid qualityScore outrank a real 4.0 in weakMatches ordering', async () => {
      const valid = row({
        id: 'weak-valid',
        qualityScore: 4.0,
      });
      const infinity = row({
        id: 'weak-infinity',
        qualityScore: Infinity,
      });
      const nan = row({ id: 'weak-nan', qualityScore: NaN });
      const aboveScale = row({
        id: 'weak-above-scale',
        qualityScore: 5.1,
      });

      const { service } = makeService([infinity, nan, aboveScale, valid]);

      const result = await service.retrieveFacetCandidates(facet(), SCOPE, {
        qualityFloor: 4.5,
      });

      expect(result.strongMatches).toEqual([]);
      // The real, valid 4.0 must sort first...
      expect(result.weakMatches[0]).toBe('weak-valid');
      // ...and every corrupt value is treated as the worst possible
      // quality, falling back to a stable id tie-break amongst themselves.
      expect(result.weakMatches.slice(1)).toEqual(
        ['weak-above-scale', 'weak-infinity', 'weak-nan'].sort(),
      );
    });
  });

  it('PD1: a row the destination window returns is tour-eligible only when WITHIN the destination polygon', async () => {
    const inside = row({ id: 'inside', qualityScore: 4.5 });
    const extendsBeyond = row({
      id: 'extends-beyond',
      qualityScore: 4.5,
      components: [
        { geoEntity: { latitude: -34.6, longitude: -58.38 } },
        { geoEntity: { latitude: -34.7, longitude: -58.38 } },
      ],
    });
    const outside = row({
      id: 'outside',
      qualityScore: 4.5,
      components: [{ geoEntity: { latitude: -34.8, longitude: -58.38 } }],
    });
    const unknown = row({ id: 'unknown', qualityScore: 4.5, components: [] });
    const { service } = makeService([inside, extendsBeyond, outside, unknown]);

    const result = await service.retrieveFacetCandidates(facet(), SCOPE);

    expect(result.strongMatches).toEqual(['inside']);
    expect(result.weakMatches).toEqual([]);
  });
});
