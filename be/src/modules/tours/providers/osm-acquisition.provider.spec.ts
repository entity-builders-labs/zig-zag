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
  });

  beforeEach(() => {
    osmPlaces = { lookupFeaturesNear: jest.fn() };
    provider = new OsmAcquisitionProvider(osmPlaces as any);
  });

  it('resolves concepts through the registry into one lookupFeaturesNear call with structured selectors', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue({
      status: 'success',
      value: [],
    });

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
    expect(result).toEqual({ status: 'success', value: [] });
  });

  it('does not call Overpass when the destination has no usable coordinates', async () => {
    const result = await provider.acquire(
      { destinationName: 'Nowhere' },
      { concepts: ['museum'] },
    );

    expect(osmPlaces.lookupFeaturesNear).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'success', value: [] });
  });

  it('maps candidates to provider-neutral SourceObservations with osm identity and no semantic inference', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue({
      status: 'success',
      value: [
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
      ],
    });

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

  it('classifies evidenceType from selector semantics, not OSM element type', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue({
      status: 'success',
      value: [
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
      ],
    });

    const result = await provider.acquire(destination, {
      concepts: ['park', 'hiking'],
    });

    const byId = Object.fromEntries(
      result.value.map((o) => [o.externalId, o.evidenceType]),
    );
    expect(byId['osm:way:10']).toBe('area'); // park + way -> area
    expect(byId['osm:node:11']).toBe('place'); // park + node -> downgraded to place
    expect(byId['osm:relation:12']).toBe('route'); // hiking route relation -> route
  });

  it('emits one observation per OSM element even when several concepts match it', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue({
      status: 'success',
      value: [
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
      ],
    });

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
    });

    const result = await provider.acquire(destination, {
      concepts: ['museum'],
    });

    expect(result).toEqual({
      status: 'failed',
      value: [],
      failureReason: 'overpass 504',
    });
  });

  it('treats a successful empty Overpass response as a clean empty acquisition', async () => {
    osmPlaces.lookupFeaturesNear.mockResolvedValue({
      status: 'success',
      value: [],
    });

    const result = await provider.acquire(destination, {
      concepts: ['museum'],
    });

    expect(result).toEqual({ status: 'success', value: [] });
  });

  it('has no persistence dependencies (constructed with only OsmPlacesService)', () => {
    // A regression guard: the provider must never gain a Prisma / catalog dep.
    expect(OsmAcquisitionProvider.length).toBe(1);
  });
});
