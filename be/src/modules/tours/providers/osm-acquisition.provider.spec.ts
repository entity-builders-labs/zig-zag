import { OsmAcquisitionProvider } from './osm-acquisition.provider';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

describe('OsmAcquisitionProvider', () => {
  let osmPlaces: { lookupFeaturesNear: jest.Mock };
  let provider: OsmAcquisitionProvider;

  const destination = {
    destinationName: 'Buenos Aires',
    latitude: -34.6037,
    longitude: -58.3816,
    radiusMeters: 4000,
  };

  const candidate = (
    over: Partial<OsmCandidate> &
      Pick<OsmCandidate, 'id' | 'osmType' | 'osmId'>,
  ): OsmCandidate => ({
    id: over.id,
    name: over.name ?? 'Unnamed',
    osmType: over.osmType,
    osmId: over.osmId,
    geometry: over.geometry ?? {
      type: 'Point',
      coordinates: [-58.38, -34.6],
    },
    tags: over.tags ?? {},
    narrativeContext: over.narrativeContext,
  });

  // Mirror OsmPlacesService.lookupFeaturesNear's OsmFeatureLookupResult shape.
  const okLookup = (value: OsmCandidate[], rawResultCount = value.length) => ({
    status: 'success' as const,
    value,
    rawResultCount,
  });

  beforeEach(() => {
    osmPlaces = { lookupFeaturesNear: jest.fn() };
    provider = new OsmAcquisitionProvider(osmPlaces as any);
  });

  it('resolves concepts through the registry into one lookupFeaturesNear call with structured selectors', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue(okLookup([]));

    await provider.acquire(destination, { concepts: ['museum', 'park'] });

    expect(osmPlaces.lookupFeaturesNear).toHaveBeenCalledTimes(1);
    const [lat, lng, radius, selectors] =
      osmPlaces.lookupFeaturesNear.mock.calls[0];
    expect(lat).toBe(-34.6037);
    expect(lng).toBe(-58.3816);
    expect(radius).toBe(4000);
    expect(selectors).toEqual([
      { key: 'tourism', value: 'museum', requireName: true },
      { key: 'leisure', value: 'park', requireName: true },
    ]);
  });

  it('does not call Overpass when every requested concept is unsupported', async () => {
    const result = await provider.acquire(destination, {
      concepts: ['building', 'tourism', 'route'],
    });

    expect(osmPlaces.lookupFeaturesNear).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.value).toEqual([]);
    expect(result.provenance).toMatchObject({
      requestedConcepts: ['building', 'route', 'tourism'],
      supportedConcepts: [],
      unsupportedConcepts: ['building', 'route', 'tourism'],
      rawResultCount: 0,
      candidateCount: 0,
      observationCount: 0,
      dedupedCount: 0,
      evidenceKeys: [],
    });
  });

  it('does not call Overpass when the destination has no usable coordinates', async () => {
    const result = await provider.acquire(
      { destinationName: 'Nowhere' },
      { concepts: ['museum'] },
    );

    expect(osmPlaces.lookupFeaturesNear).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.value).toEqual([]);
    expect(result.provenance).toMatchObject({
      supportedConcepts: ['museum'],
      unsupportedConcepts: [],
      rawResultCount: 0,
      observationCount: 0,
    });
  });

  it('maps candidates to provider-neutral SourceObservations with osm identity and no semantic inference', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue(
      okLookup([
        candidate({
          id: 'osm:node:1',
          osmType: 'node',
          osmId: 1,
          name: 'Museo Histórico Nacional',
          tags: {
            name: 'Museo Histórico Nacional',
            tourism: 'museum',
            description: 'Casa colonial',
          },
        }),
      ]),
    );

    const result = await provider.acquire(destination, {
      concepts: ['museum'],
    });

    expect(result.status).toBe('success');
    expect(result.value).toHaveLength(1);
    const obs = result.value[0];
    expect(obs.provider).toBe('osm');
    expect(obs.externalId).toBe('osm:node:1');
    expect(obs.evidenceKey).toBe('osm:node:1');
    expect(obs.title).toBe('Museo Histórico Nacional');
    expect(obs.description).toBe('Casa colonial');
    expect(obs.evidenceType).toBe('place');
    expect(obs.geo).toEqual({ latitude: -34.6, longitude: -58.38 });
    expect(obs.metadata).toEqual({
      osmType: 'node',
      osmTags: {
        name: 'Museo Histórico Nacional',
        tourism: 'museum',
        description: 'Casa colonial',
      },
      matchedConcepts: ['museum'],
    });
    // no invented semantics
    expect((obs as any).themes).toBeUndefined();
    expect((obs as any).traits).toBeUndefined();
    expect((obs as any).intents).toBeUndefined();
    expect((obs.metadata as any).themes).toBeUndefined();
  });

  it('preserves narrativeContext in metadata when the candidate carries it (Task B1)', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue(
      okLookup([
        candidate({
          id: 'osm:node:2',
          osmType: 'node',
          osmId: 2,
          name: 'Cabildo de Buenos Aires',
          tags: { name: 'Cabildo de Buenos Aires', tourism: 'museum' },
          narrativeContext:
            'A colonial-era town hall, now a museum of the May Revolution.',
        }),
      ]),
    );

    const result = await provider.acquire(destination, {
      concepts: ['museum'],
    });

    expect(result.value[0].metadata).toEqual(
      expect.objectContaining({
        narrativeContext:
          'A colonial-era town hall, now a museum of the May Revolution.',
      }),
    );
  });

  it('classifies evidenceType from selector semantics, not OSM element type', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue(
      okLookup([
        candidate({
          id: 'osm:way:10',
          osmType: 'way',
          osmId: 10,
          name: 'Parque Centenario',
          tags: { name: 'Parque Centenario', leisure: 'park' },
        }),
        candidate({
          id: 'osm:node:11',
          osmType: 'node',
          osmId: 11,
          name: 'Plaza chica',
          tags: { name: 'Plaza chica', leisure: 'park' },
        }),
        candidate({
          id: 'osm:relation:12',
          osmType: 'relation',
          osmId: 12,
          name: 'Sendero de los Cerros',
          tags: { name: 'Sendero de los Cerros', route: 'hiking' },
        }),
      ]),
    );

    const result = await provider.acquire(destination, {
      concepts: ['park', 'hiking'],
    });

    const byId = Object.fromEntries(
      result.value.map((o) => [o.externalId, o.evidenceType]),
    );
    expect(byId['osm:way:10']).toBe('area'); // park + way -> area
    expect(byId['osm:node:11']).toBe('place'); // park + node -> downgraded to place
    expect(byId['osm:relation:12']).toBe('route'); // hiking route relation -> route
    expect(
      result.value.find((o) => o.externalId === 'osm:way:10')
        ?.originationCapabilities,
    ).toEqual([]);
    expect(
      result.value.find((o) => o.externalId === 'osm:relation:12')
        ?.originationCapabilities,
    ).toEqual(['GENERAL_TOURISM_EXPERIENCE', 'CANONICAL_ROUTE']);
  });

  it('emits one observation per OSM element even when several concepts match it', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue(
      okLookup([
        candidate({
          id: 'osm:node:20',
          osmType: 'node',
          osmId: 20,
          name: 'Monumento a la Bandera',
          tags: {
            name: 'Monumento a la Bandera',
            historic: 'monument',
            tourism: 'viewpoint',
          },
        }),
      ]),
    );

    const result = await provider.acquire(destination, {
      concepts: ['monument', 'historic', 'viewpoint'],
    });

    expect(result.value).toHaveLength(1);
    expect(result.value[0].metadata!.matchedConcepts).toEqual([
      'historic',
      'monument',
      'viewpoint',
    ]);
  });

  it('propagates an Overpass failure as a failed provider result (isolated, no throw)', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue({
      status: 'failed',
      value: [],
      failureReason: 'overpass 504',
      rawResultCount: 0,
    });

    const result = await provider.acquire(destination, {
      concepts: ['museum'],
    });

    expect(result.status).toBe('failed');
    expect(result.value).toEqual([]);
    expect(result.failureReason).toBe('overpass 504');
    // Failure stays observable: concept resolution is still reported.
    expect(result.provenance).toMatchObject({
      requestedConcepts: ['museum'],
      supportedConcepts: ['museum'],
      unsupportedConcepts: [],
      rawResultCount: 0,
      observationCount: 0,
    });
  });

  it('treats a successful empty Overpass response as a clean empty acquisition', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue(okLookup([], 0));

    const result = await provider.acquire(destination, {
      concepts: ['museum'],
    });

    expect(result.status).toBe('success');
    expect(result.value).toEqual([]);
    expect(result.provenance).toMatchObject({
      rawResultCount: 0,
      candidateCount: 0,
      observationCount: 0,
    });
  });

  it('has no persistence dependencies (constructed with only OsmPlacesService)', () => {
    // A regression guard: the provider must never gain a Prisma / catalog dep.
    expect(OsmAcquisitionProvider.length).toBe(1);
  });

  describe('deterministic output order', () => {
    const elements = [
      candidate({
        id: 'osm:node:1',
        osmType: 'node',
        osmId: 1,
        name: 'A',
        tags: { name: 'A', tourism: 'museum' },
      }),
      candidate({
        id: 'osm:node:2',
        osmType: 'node',
        osmId: 2,
        name: 'B',
        tags: { name: 'B', tourism: 'museum' },
      }),
      candidate({
        id: 'osm:node:3',
        osmType: 'node',
        osmId: 3,
        name: 'C',
        tags: { name: 'C', leisure: 'park' },
      }),
    ];

    it('is independent of Overpass response order (forward vs reversed) and sorted by evidenceKey', async () => {
      osmPlaces.lookupFeaturesNear.mockResolvedValueOnce(okLookup(elements));
      const forward = await provider.acquire(destination, {
        concepts: ['museum', 'park'],
      });

      osmPlaces.lookupFeaturesNear.mockResolvedValueOnce(
        okLookup([...elements].reverse()),
      );
      const reversed = await provider.acquire(destination, {
        concepts: ['museum', 'park'],
      });

      expect(forward).toEqual(reversed);
      expect(forward.value.map((o) => o.evidenceKey)).toEqual([
        'osm:node:1',
        'osm:node:2',
        'osm:node:3',
      ]);
    });

    it('is independent of concept input order', async () => {
      osmPlaces.lookupFeaturesNear.mockResolvedValue(okLookup(elements));

      const a = await provider.acquire(destination, {
        concepts: ['park', 'museum'],
      });
      const b = await provider.acquire(destination, {
        concepts: ['museum', 'park'],
      });

      expect(a).toEqual(b);
      const [, , , selectorsA] = osmPlaces.lookupFeaturesNear.mock.calls[0];
      const [, , , selectorsB] = osmPlaces.lookupFeaturesNear.mock.calls[1];
      expect(selectorsA).toEqual(selectorsB);
    });
  });

  describe('defensive geo validation', () => {
    const withGeometry = (geometry: any) =>
      candidate({
        id: 'osm:node:9',
        osmType: 'node',
        osmId: 9,
        name: 'Weird Place',
        tags: { name: 'Weird Place', tourism: 'museum' },
        geometry,
      });

    it('emits a valid geo for a valid Point', async () => {
      osmPlaces.lookupFeaturesNear.mockResolvedValue(
        okLookup([
          withGeometry({ type: 'Point', coordinates: [-58.38, -34.6] }),
        ]),
      );
      const result = await provider.acquire(destination, {
        concepts: ['museum'],
      });
      expect(result.value[0].geo).toEqual({
        latitude: -34.6,
        longitude: -58.38,
      });
    });

    it.each([
      ['NaN coordinates', { type: 'Point', coordinates: [NaN, NaN] }],
      ['Infinity coordinates', { type: 'Point', coordinates: [Infinity, 0] }],
      ['latitude > 90', { type: 'Point', coordinates: [10, 91] }],
      ['longitude > 180', { type: 'Point', coordinates: [181, 10] }],
      ['empty LineString', { type: 'LineString', coordinates: [] }],
    ])(
      'omits geo for %s but still emits the observation',
      async (_label, geometry) => {
        osmPlaces.lookupFeaturesNear.mockResolvedValue(
          okLookup([withGeometry(geometry)]),
        );
        const result = await provider.acquire(destination, {
          concepts: ['museum'],
        });

        expect(result.value).toHaveLength(1);
        expect(result.value[0].geo).toBeUndefined();
        expect(result.value[0].externalId).toBe('osm:node:9');
        expect(result.value[0].title).toBe('Weird Place');
      },
    );
  });

  describe('winery semantics', () => {
    it('matches craft=winery but NOT shop=wine (a wine shop is not a winery)', async () => {
      osmPlaces.lookupFeaturesNear.mockResolvedValue(
        okLookup([
          candidate({
            id: 'osm:way:1',
            osmType: 'way',
            osmId: 1,
            name: 'Bodega Real',
            tags: { name: 'Bodega Real', craft: 'winery' },
          }),
          candidate({
            id: 'osm:node:2',
            osmType: 'node',
            osmId: 2,
            name: 'Vinoteca del Centro',
            tags: { name: 'Vinoteca del Centro', shop: 'wine' },
          }),
        ]),
      );

      const result = await provider.acquire(destination, {
        concepts: ['winery'],
      });

      expect(result.value.map((o) => o.externalId)).toEqual(['osm:way:1']);
      expect(result.value[0].metadata!.matchedConcepts).toEqual(['winery']);
    });
  });

  describe('structured provenance', () => {
    it('reports raw / candidate / observation / deduped counts and evidenceKeys', async () => {
      // Two raw candidates for the SAME element (union matched it twice) + one
      // distinct element. lookup already filtered nameless/invalid, so
      // candidateCount = 3, observationCount = 2, dedupedCount = 1.
      osmPlaces.lookupFeaturesNear.mockResolvedValue(
        okLookup(
          [
            candidate({
              id: 'osm:node:1',
              osmType: 'node',
              osmId: 1,
              name: 'Museo',
              tags: { name: 'Museo', tourism: 'museum', historic: 'monument' },
            }),
            candidate({
              id: 'osm:node:1',
              osmType: 'node',
              osmId: 1,
              name: 'Museo',
              tags: { name: 'Museo', tourism: 'museum', historic: 'monument' },
            }),
            candidate({
              id: 'osm:way:2',
              osmType: 'way',
              osmId: 2,
              name: 'Parque',
              tags: { name: 'Parque', leisure: 'park' },
            }),
          ],
          5, // raw Overpass returned more rows than survived adapter filtering
        ),
      );

      const result = await provider.acquire(destination, {
        concepts: ['museum', 'monument', 'park', 'building'],
      });

      expect(result.provenance).toEqual({
        provider: 'osm',
        requestedConcepts: ['building', 'monument', 'museum', 'park'],
        supportedConcepts: ['monument', 'museum', 'park'],
        unsupportedConcepts: ['building'],
        radiusRequestedMeters: 4000,
        rawResultCount: 5,
        candidateCount: 3,
        observationCount: 2,
        dedupedCount: 1,
        evidenceKeys: ['osm:node:1', 'osm:way:2'],
      });
    });
  });
});
