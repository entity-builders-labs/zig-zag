import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { StructuredPoiAcquisitionProvider } from './structured-poi-acquisition.provider';

describe('StructuredPoiAcquisitionProvider', () => {
  const destination = {
    destinationName: 'Buenos Aires',
    latitude: -34.6,
    longitude: -58.38,
    radiusMeters: 5_000,
  };

  it('keeps an OSM provider failure as a typed failed outcome', async () => {
    const osm = {
      lookupFeaturesNear: jest.fn().mockResolvedValue({
        status: 'failed',
        value: [],
        rawResultCount: 0,
        failureReason: 'Overpass unavailable',
      }),
    } as unknown as OsmPlacesService;
    const provider = new StructuredPoiAcquisitionProvider(osm);

    await expect(
      provider.acquire(destination, { radiusMeters: 5_000 }),
    ).resolves.toMatchObject({
      status: 'failed',
      value: [],
      failureReason: 'Overpass unavailable',
      provenance: { sourceClass: 'STRUCTURED_POI', status: 'FAILED' },
    });
  });

  it('normalizes discovered OSM records without converting provider facts into prose', async () => {
    const osm = {
      lookupFeaturesNear: jest.fn().mockResolvedValue({
        status: 'success',
        rawResultCount: 1,
        value: [
          {
            id: 'osm:node:123',
            name: 'Museo de Arte',
            osmType: 'node',
            osmId: 123,
            geometry: { type: 'Point', coordinates: [-58.38, -34.6] },
            tags: { tourism: 'museum', wikidata: 'Q123' },
          },
        ],
      }),
    } as unknown as OsmPlacesService;
    const provider = new StructuredPoiAcquisitionProvider(osm);

    const result = await provider.acquire(destination, { radiusMeters: 5_000 });
    expect(result.status).toBe('success');
    expect(result.value).toEqual([
      expect.objectContaining({
        provider: 'structured_poi',
        externalId: 'osm:node:123',
        title: 'Museo de Arte',
        evidenceType: 'place',
        canonicalIdentity: { wikidataQid: 'Q123' },
        geo: {
          latitude: -34.6,
          longitude: -58.38,
          geometry: { type: 'Point', coordinates: [-58.38, -34.6] },
        },
      }),
    ]);
    expect(osm.lookupFeaturesNear).toHaveBeenCalledWith(
      destination.latitude,
      destination.longitude,
      5_000,
      expect.arrayContaining([
        { key: 'tourism' },
        { key: 'amenity', value: 'place_of_worship' },
      ]),
    );
  });

  it('fails when the destination window is missing instead of inventing a radius', async () => {
    const osm = {
      lookupFeaturesNear: jest.fn(),
    } as unknown as OsmPlacesService;
    const provider = new StructuredPoiAcquisitionProvider(osm);

    const result = await provider.acquire(
      { destinationName: 'Buenos Aires' },
      { radiusMeters: 5_000 },
    );
    expect(result.status).toBe('failed');
    expect(osm.lookupFeaturesNear).not.toHaveBeenCalled();
  });

  describe('encyclopedic entity facts fetched for the QIDs of discovered places', () => {
    const osmWith = (tags: Record<string, string>[]) =>
      ({
        lookupFeaturesNear: jest.fn().mockResolvedValue({
          status: 'success',
          rawResultCount: tags.length,
          value: tags.map((t, index) => ({
            id: `osm:node:${index + 1}`,
            name: `Place ${index + 1}`,
            osmType: 'node',
            osmId: index + 1,
            geometry: { type: 'Point', coordinates: [-58.38, -34.6] },
            tags: t,
          })),
        }),
      }) as unknown as OsmPlacesService;

    it('attaches KNOWN, NOT_FOUND and UNAVAILABLE outcomes per QID and records the batch outcome', async () => {
      const wikidata = {
        lookupStructuredEntityFacts: jest.fn().mockResolvedValue({
          facts: new Map([
            [
              'Q1',
              {
                qid: 'Q1',
                instanceOf: [],
                heritageDesignations: [],
                hasCoordinateLocation: true,
                sitelinks: [
                  { site: 'eswiki', url: 'https://es.wikipedia.org/wiki/A' },
                ],
              },
            ],
          ]),
          missingQids: new Set(['Q2']),
          failedQids: new Set(['Q3']),
          observedAt: new Date('2026-10-23T00:00:00Z'),
        }),
      };
      const provider = new StructuredPoiAcquisitionProvider(
        osmWith([
          { historic: 'memorial', wikidata: 'Q1' },
          { historic: 'memorial', wikidata: 'Q2' },
          { historic: 'memorial', wikidata: 'Q3' },
          { historic: 'memorial' },
        ]),
        wikidata as any,
      );

      const result = await provider.acquire(destination, {
        radiusMeters: 5_000,
        entityFacts: { sourceClass: 'STRUCTURED_ENTITY_FACTS' },
      });

      expect(wikidata.lookupStructuredEntityFacts).toHaveBeenCalledWith([
        'Q1',
        'Q2',
        'Q3',
      ]);
      expect(result.status).toBe('success');
      expect(result.value.map((c) => c.entityFacts?.status)).toEqual([
        'KNOWN',
        'NOT_FOUND',
        'UNAVAILABLE',
        undefined,
      ]);
      expect(result.value[0].entityFacts).toMatchObject({
        admission: { sitelinkCount: 1 },
        prominence: [{ kind: 'ENCYCLOPEDIC_SITELINK_COUNT', numericValue: 1 }],
      });
      expect(result.provenance).toMatchObject({
        entityFacts: {
          sourceClass: 'STRUCTURED_ENTITY_FACTS',
          status: 'PARTIAL',
          requested: 3,
          known: 1,
          notFound: 1,
          unavailable: 1,
        },
      });
    });

    it('an unavailable encyclopedic provider never fails OSM discovery; QIDs stay UNAVAILABLE', async () => {
      const provider = new StructuredPoiAcquisitionProvider(
        osmWith([{ tourism: 'museum', wikidata: 'Q9' }]),
      );
      const result = await provider.acquire(destination, {
        radiusMeters: 5_000,
        entityFacts: { sourceClass: 'STRUCTURED_ENTITY_FACTS' },
      });
      expect(result.status).toBe('success');
      expect(result.value[0].entityFacts).toEqual({
        status: 'UNAVAILABLE',
        qid: 'Q9',
      });
      expect(result.value[0].prominenceEvidence).toEqual([
        expect.objectContaining({
          kind: 'EXPLICIT_VISITOR_CLASSIFICATION',
          textValue: 'tourism=museum',
        }),
      ]);
      expect(result.provenance).toMatchObject({
        entityFacts: { status: 'FAILED', unavailable: 1 },
      });
    });

    it('does not call the encyclopedic provider when the route did not plan it', async () => {
      const wikidata = { lookupStructuredEntityFacts: jest.fn() };
      const provider = new StructuredPoiAcquisitionProvider(
        osmWith([{ tourism: 'museum', wikidata: 'Q9' }]),
        wikidata as any,
      );
      const result = await provider.acquire(destination, {
        radiusMeters: 5_000,
      });
      expect(wikidata.lookupStructuredEntityFacts).not.toHaveBeenCalled();
      expect(result.value[0].entityFacts).toBeUndefined();
    });
  });

  describe('gap-scoped food-and-drink coverage', () => {
    const emptyOsm = () =>
      ({
        lookupFeaturesNear: jest.fn().mockResolvedValue({
          status: 'success',
          rawResultCount: 0,
          value: [],
        }),
      }) as unknown as OsmPlacesService;

    it('queries only identity-linked food venue classes when no capacity gap asks for base discovery', async () => {
      const osm = emptyOsm();
      const result = await new StructuredPoiAcquisitionProvider(osm).acquire(
        destination,
        {
          radiusMeters: 5_000,
          baseDiscovery: false,
          coverage: ['FOOD_AND_DRINK'],
        },
      );

      const selectors = (osm.lookupFeaturesNear as jest.Mock).mock.calls[0][3];
      expect(selectors).toEqual([
        { key: 'amenity', value: 'cafe', requireKeys: ['wikidata'] },
        { key: 'amenity', value: 'restaurant', requireKeys: ['wikidata'] },
        { key: 'amenity', value: 'food_court', requireKeys: ['wikidata'] },
        { key: 'amenity', value: 'marketplace', requireKeys: ['wikidata'] },
        { key: 'shop', value: 'bakery', requireKeys: ['wikidata'] },
      ]);
      expect(result.provenance).toMatchObject({
        baseDiscovery: false,
        coverage: ['FOOD_AND_DRINK'],
      });
    });

    it('adds the coverage selectors after the base selectors when both are requested', async () => {
      const osm = emptyOsm();
      await new StructuredPoiAcquisitionProvider(osm).acquire(destination, {
        radiusMeters: 5_000,
        coverage: ['FOOD_AND_DRINK'],
      });
      const selectors = (osm.lookupFeaturesNear as jest.Mock).mock.calls[0][3];
      expect(selectors[0]).toEqual({ key: 'tourism' });
      expect(
        selectors
          .slice(-5)
          .every((s: any) => s.requireKeys?.[0] === 'wikidata'),
      ).toBe(true);
    });
  });
});
