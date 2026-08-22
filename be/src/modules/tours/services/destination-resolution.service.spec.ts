import { Test, TestingModule } from '@nestjs/testing';
import { ActivityKind } from '@prisma/client';
import { DestinationResolutionService } from './destination-resolution.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';

describe('DestinationResolutionService', () => {
  let service: DestinationResolutionService;
  let nominatimApi: { search: jest.Mock; reverse: jest.Mock };
  let osmPlacesService: {
    getBoundaryById: jest.Mock;
    lookupBoundaryById: jest.Mock;
  };
  let compositeActivityService: { resolveArea: jest.Mock };

  beforeEach(async () => {
    nominatimApi = { search: jest.fn(), reverse: jest.fn() };
    osmPlacesService = {
      getBoundaryById: jest.fn(),
      lookupBoundaryById: jest.fn(async (...args: any[]) => ({
        status: 'success',
        value: await osmPlacesService.getBoundaryById(...args),
      })),
    };
    compositeActivityService = { resolveArea: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DestinationResolutionService,
        { provide: 'NominatimApiService', useValue: nominatimApi },
        { provide: OsmPlacesService, useValue: osmPlacesService },
        {
          provide: CompositeActivityService,
          useValue: compositeActivityService,
        },
      ],
    }).compile();

    service = module.get(DestinationResolutionService);
  });

  it('resolves a city-addresstype result to area-scale and persists the AREA activity', async () => {
    nominatimApi.search.mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 1224652,
        addresstype: 'city',
        displayName: 'Buenos Aires',
        importance: 0.8,
      },
    ]);
    const boundary = {
      id: 'osm:relation:1224652',
      name: 'Buenos Aires',
      osmType: 'relation' as const,
      osmId: 1224652,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      tags: { name: 'Buenos Aires', admin_level: '8' },
    };
    osmPlacesService.getBoundaryById.mockResolvedValue(boundary);
    const areaActivity = {
      id: 'area-1',
      kind: ActivityKind.AREA,
      name: 'Buenos Aires',
    };
    compositeActivityService.resolveArea.mockResolvedValue(areaActivity);

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toEqual({
      scale: 'area',
      areaActivity,
      boundary,
      attemptedQueries: ['forward:Buenos Aires'],
      selectedResult: {
        osmType: 'relation',
        osmId: 1224652,
        displayName: 'Buenos Aires',
      },
    });
    expect(compositeActivityService.resolveArea).toHaveBeenCalledWith(boundary);
  });

  it.each(['state', 'country'])(
    'falls back to point-scale for a %s-level Nominatim result',
    async (addresstype) => {
      nominatimApi.search.mockResolvedValue([
        {
          osmType: 'relation',
          osmId: 1,
          addresstype,
          displayName: 'x',
          importance: 0.9,
        },
      ]);

      const result = await service.resolveDestination('Some place');

      expect(result).toEqual({
        scale: 'point',
        attemptedQueries: ['forward:Some place'],
        degradationReason: 'no_area_candidate',
      });
      expect(osmPlacesService.getBoundaryById).not.toHaveBeenCalled();
    },
  );

  it('falls back to point-scale for a village-addresstype result backed by a bare node (no boundary polygon)', async () => {
    nominatimApi.search.mockResolvedValue([
      {
        osmType: 'node',
        osmId: 42,
        addresstype: 'village',
        displayName: 'Tiny Hamlet',
        importance: 0.5,
      },
    ]);

    const result = await service.resolveDestination('Tiny Hamlet');

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: ['forward:Tiny Hamlet'],
      degradationReason: 'no_area_candidate',
    });
    expect(osmPlacesService.getBoundaryById).not.toHaveBeenCalled();
  });

  it('falls back to point-scale when Nominatim returns nothing', async () => {
    nominatimApi.search.mockResolvedValue([]);

    const result = await service.resolveDestination('123 Main St');

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: ['forward:123 Main St'],
      degradationReason: 'no_area_candidate',
    });
  });

  it('falls back to point-scale when no destination text is given', async () => {
    const result = await service.resolveDestination(undefined);

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: [],
      degradationReason: 'missing_destination',
    });
    expect(nominatimApi.search).not.toHaveBeenCalled();
  });

  it('falls back to point-scale when the resolved boundary geometry cannot be fetched', async () => {
    nominatimApi.search.mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 1224652,
        addresstype: 'city',
        displayName: 'Buenos Aires',
        importance: 0.8,
      },
    ]);
    osmPlacesService.getBoundaryById.mockResolvedValue(null);

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: ['forward:Buenos Aires'],
      selectedResult: {
        osmType: 'relation',
        osmId: 1224652,
        displayName: 'Buenos Aires',
      },
      degradationReason: 'boundary_unavailable',
    });
  });

  it('falls back to point-scale (never throws) when Nominatim itself fails', async () => {
    nominatimApi.search.mockRejectedValue(new Error('network down'));

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: ['forward:Buenos Aires'],
      degradationReason: 'provider_failed',
    });
  });

  it('reports provider failure when reverse geocoding fails during normalization', async () => {
    nominatimApi.search.mockResolvedValue([]);
    nominatimApi.reverse.mockRejectedValue(new Error('reverse unavailable'));

    const result = await service.resolveDestination('Overqualified label', {
      latitude: -34.6037,
      longitude: -58.3816,
    });

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: [
        'forward:Overqualified label',
        'reverse:-34.603700,-58.381600',
      ],
      degradationReason: 'provider_failed',
    });
  });

  it('reports provider failure when Overpass cannot fetch a selected boundary', async () => {
    nominatimApi.search.mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 1224652,
        addresstype: 'city',
        displayName: 'Buenos Aires',
        importance: 0.8,
      },
    ]);
    osmPlacesService.lookupBoundaryById.mockResolvedValue({
      status: 'failed',
      value: null,
      failureReason: 'Overpass unavailable',
    });

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toMatchObject({
      scale: 'point',
      selectedResult: { osmId: 1224652 },
      degradationReason: 'provider_failed',
    });
  });

  it('normalizes an overqualified Montevideo provider label using structured reverse context', async () => {
    nominatimApi.search.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        osmType: 'relation',
        osmId: 2929054,
        addresstype: 'city',
        displayName: 'Montevideo, Uruguay',
        importance: 0.7,
        latitude: -34.9059,
        longitude: -56.1913,
        address: { city: 'Montevideo', country: 'Uruguay', countryCode: 'UY' },
      },
    ]);
    nominatimApi.reverse.mockResolvedValue({
      osmType: 'relation',
      osmId: 2929054,
      addresstype: 'city',
      displayName: 'Montevideo, Uruguay',
      importance: 0.7,
      latitude: -34.9059,
      longitude: -56.1913,
      address: { city: 'Montevideo', country: 'Uruguay', countryCode: 'UY' },
    });
    const boundary = {
      id: 'osm:relation:2929054',
      name: 'Montevideo',
      osmType: 'relation' as const,
      osmId: 2929054,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-56.3, -35],
            [-56.1, -35],
            [-56.1, -34.8],
            [-56.3, -35],
          ],
        ],
      },
      tags: { name: 'Montevideo', admin_level: '8' },
    };
    osmPlacesService.getBoundaryById.mockResolvedValue(boundary);
    const areaActivity = {
      id: 'area-montevideo',
      kind: ActivityKind.AREA,
      name: 'Montevideo',
    };
    compositeActivityService.resolveArea.mockResolvedValue(areaActivity);

    const result = await service.resolveDestination(
      'Montevideo, Montevideo Department, Uruguay',
      { latitude: -34.9059, longitude: -56.1913 },
    );

    expect(nominatimApi.search).toHaveBeenNthCalledWith(
      2,
      'Montevideo, Uruguay',
    );
    expect(result).toMatchObject({
      scale: 'area',
      boundary,
      attemptedQueries: [
        'forward:Montevideo, Montevideo Department, Uruguay',
        'reverse:-34.905900,-56.191300',
        'forward:Montevideo, Uruguay',
      ],
      selectedResult: { osmId: 2929054 },
    });
  });

  it('normalizes Salta when forward search only returns unrelated same-name POIs far from the selected coordinates', async () => {
    nominatimApi.search.mockResolvedValueOnce([
      {
        osmType: 'node',
        osmId: 11386663543,
        addresstype: 'amenity',
        displayName: 'Villegas Salta, Parana, Entre Rios, Argentina',
        importance: 0.2,
        latitude: -31.7281737,
        longitude: -60.5230802,
      },
      {
        osmType: 'way',
        osmId: 1121044810,
        addresstype: 'building',
        displayName: 'Nehuen Salta, Neuquen, Argentina',
        importance: 0.2,
        latitude: -38.9513273,
        longitude: -68.0665156,
      },
    ]);
    nominatimApi.reverse.mockResolvedValue({
      osmType: 'relation',
      osmId: 2722832,
      addresstype: 'city',
      displayName: 'Salta, Capital, Salta, Argentina',
      importance: 0.7,
      latitude: -24.7892946,
      longitude: -65.4103194,
      address: { city: 'Salta', country: 'Argentina', countryCode: 'AR' },
    });
    nominatimApi.search.mockResolvedValueOnce([]);

    const boundary = {
      id: 'osm:relation:2722832',
      name: 'Salta',
      osmType: 'relation' as const,
      osmId: 2722832,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-65.5, -24.9],
            [-65.3, -24.9],
            [-65.3, -24.7],
            [-65.5, -24.9],
          ],
        ],
      },
      tags: { name: 'Salta', admin_level: '8' },
    };
    osmPlacesService.getBoundaryById.mockResolvedValue(boundary);
    const areaActivity = {
      id: 'area-salta',
      kind: ActivityKind.AREA,
      name: 'Salta',
    };
    compositeActivityService.resolveArea.mockResolvedValue(areaActivity);

    const result = await service.resolveDestination(
      'Salta, Salta Province, Argentina',
      { latitude: -24.7821269, longitude: -65.4231976 },
    );

    expect(nominatimApi.reverse).toHaveBeenCalledWith(-24.7821269, -65.4231976);
    expect(nominatimApi.search).toHaveBeenNthCalledWith(2, 'Salta, Argentina');
    expect(result).toMatchObject({
      scale: 'area',
      boundary,
      attemptedQueries: [
        'forward:Salta, Salta Province, Argentina',
        'reverse:-24.782127,-65.423198',
        'forward:Salta, Argentina',
      ],
      selectedResult: { osmId: 2722832 },
    });
  });

  it('keeps a successfully resolved hotel at point scale without normalizing it to its city', async () => {
    nominatimApi.search.mockResolvedValue([
      {
        osmType: 'node',
        osmId: 99,
        addresstype: 'hotel',
        displayName: 'Hotel Cervantes, Montevideo, Uruguay',
        importance: 0.4,
        latitude: -34.9,
        longitude: -56.19,
      },
    ]);

    const result = await service.resolveDestination(
      'Hotel Cervantes, Montevideo, Uruguay',
      { latitude: -34.9, longitude: -56.19 },
    );

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: ['forward:Hotel Cervantes, Montevideo, Uruguay'],
      degradationReason: 'no_area_candidate',
    });
    expect(nominatimApi.reverse).not.toHaveBeenCalled();
  });

  it('rejects an area candidate that is inconsistent with the selected coordinates', async () => {
    nominatimApi.search.mockResolvedValue([
      {
        osmType: 'relation',
        osmId: 1,
        addresstype: 'city',
        displayName: 'Montevideo, Minnesota, USA',
        importance: 0.5,
        latitude: 44.94,
        longitude: -95.72,
        address: {
          city: 'Montevideo',
          country: 'United States',
          countryCode: 'US',
        },
      },
    ]);
    nominatimApi.reverse.mockResolvedValue(null);

    const result = await service.resolveDestination('Montevideo', {
      latitude: -34.9059,
      longitude: -56.1913,
    });

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: ['forward:Montevideo', 'reverse:-34.905900,-56.191300'],
      degradationReason: 'candidate_mismatched_coordinates',
    });
    expect(osmPlacesService.getBoundaryById).not.toHaveBeenCalled();
  });
});
