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
});
