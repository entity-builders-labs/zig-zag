import { Test, TestingModule } from '@nestjs/testing';
import { DestinationResolutionService } from './destination-resolution.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { DestinationScaleHint } from '../interfaces/tour-generation.interface';

describe('DestinationResolutionService', () => {
  let service: DestinationResolutionService;
  let nominatimApi: { search: jest.Mock; reverse: jest.Mock };
  let osmPlacesService: {
    getBoundaryById: jest.Mock;
    lookupBoundaryById: jest.Mock;
    lookupDestinationBoundary: jest.Mock;
  };

  beforeEach(async () => {
    nominatimApi = { search: jest.fn(), reverse: jest.fn() };
    osmPlacesService = {
      getBoundaryById: jest.fn(),
      lookupBoundaryById: jest.fn(async (...args: any[]) => ({
        status: 'success',
        value: await osmPlacesService.getBoundaryById(...args),
      })),
      lookupDestinationBoundary: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DestinationResolutionService,
        { provide: 'NominatimApiService', useValue: nominatimApi },
        { provide: OsmPlacesService, useValue: osmPlacesService },
      ],
    }).compile();

    service = module.get(DestinationResolutionService);
  });

  it('keeps an autocomplete-selected POI point-scale without widening it through reverse geocoding', async () => {
    const result = await service.resolveDestination(
      'Caminito, Buenos Aires',
      { latitude: -34.639, longitude: -58.362 },
      DestinationScaleHint.SPECIFIC_POINT,
    );

    expect(result).toEqual({
      scale: 'point',
      attemptedQueries: [],
      pointReason: 'specific_point_hint',
    });
    expect(nominatimApi.search).not.toHaveBeenCalled();
    expect(nominatimApi.reverse).not.toHaveBeenCalled();
    expect(osmPlacesService.lookupBoundaryById).not.toHaveBeenCalled();
  });

  it('resolves a city-addresstype result to area-scale with its boundary', async () => {
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

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toEqual({
      scale: 'area',
      boundary,
      attemptedQueries: ['forward:Buenos Aires'],
      selectedResult: {
        osmType: 'relation',
        osmId: 1224652,
        displayName: 'Buenos Aires',
      },
    });
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

  it('reports a matched village node separately when no boundary can be hydrated', async () => {
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
      settlementResult: {
        osmType: 'node',
        osmId: 42,
        displayName: 'Tiny Hamlet',
      },
      degradationReason: 'boundary_unavailable',
    });
    expect(osmPlacesService.getBoundaryById).not.toHaveBeenCalled();
  });

  it('hydrates the administrative boundary for a coordinate-consistent San Juan city node', async () => {
    nominatimApi.search
      .mockResolvedValueOnce([
        {
          osmType: 'way',
          osmId: 1,
          addresstype: 'road',
          displayName: 'San Juan, Mar del Plata, Argentina',
          importance: 0.1,
          latitude: -38.0,
          longitude: -57.5,
        },
      ])
      .mockResolvedValueOnce([
        {
          osmType: 'node',
          osmId: 198421467,
          addresstype: 'city',
          displayName: 'San Juan, Capital, San Juan, Argentina',
          importance: 0.62,
          latitude: -31.53709,
          longitude: -68.52518,
          address: {
            city: 'San Juan',
            state: 'San Juan',
            country: 'Argentina',
            countryCode: 'AR',
          },
        },
      ]);
    nominatimApi.reverse.mockResolvedValue({
      osmType: 'relation',
      osmId: 19285517,
      addresstype: 'suburb',
      displayName: 'Desamparados, San Juan, Argentina',
      importance: 0.4,
      latitude: -31.5342681,
      longitude: -68.5508917,
      address: {
        suburb: 'Desamparados',
        city: 'San Juan',
        stateDistrict: 'Capital',
        state: 'San Juan',
        country: 'Argentina',
        countryCode: 'AR',
      },
    });
    const boundary = {
      id: 'osm:relation:3465536',
      name: 'Capital',
      osmType: 'relation' as const,
      osmId: 3465536,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-68.57, -31.57],
            [-68.5, -31.57],
            [-68.5, -31.5],
            [-68.57, -31.57],
          ],
        ],
      },
      tags: { name: 'Capital', admin_level: '5' },
    };
    osmPlacesService.lookupDestinationBoundary.mockResolvedValue({
      status: 'success',
      value: boundary,
    });

    const result = await service.resolveDestination(
      'San Juan, San Juan Province, Argentina',
      { latitude: -31.535107, longitude: -68.538594 },
    );

    expect(nominatimApi.search).toHaveBeenNthCalledWith(
      2,
      'San Juan, Argentina',
    );
    expect(osmPlacesService.lookupDestinationBoundary).toHaveBeenCalledWith(
      -31.535107,
      -68.538594,
      ['Capital'],
    );
    expect(result).toEqual({
      scale: 'area',
      boundary,
      attemptedQueries: [
        'forward:San Juan, San Juan Province, Argentina',
        'reverse:-31.535107,-68.538594',
        'forward:San Juan, Argentina',
        'containing-boundary:-31.535107,-68.538594',
      ],
      settlementResult: {
        osmType: 'node',
        osmId: 198421467,
        displayName: 'San Juan, Capital, San Juan, Argentina',
      },
      selectedResult: {
        osmType: 'relation',
        osmId: 3465536,
        displayName: 'Capital',
      },
    });
  });

  it('does not misreport a matched settlement node as a coordinate mismatch when boundary hydration fails', async () => {
    nominatimApi.search.mockResolvedValue([
      {
        osmType: 'node',
        osmId: 198421467,
        addresstype: 'city',
        displayName: 'San Juan, Argentina',
        importance: 0.62,
        latitude: -31.53709,
        longitude: -68.52518,
        address: {
          city: 'San Juan',
          stateDistrict: 'Capital',
          country: 'Argentina',
          countryCode: 'AR',
        },
      },
    ]);
    nominatimApi.reverse.mockResolvedValue({
      osmType: 'node',
      osmId: 198421467,
      addresstype: 'city',
      displayName: 'San Juan, Argentina',
      importance: 0.62,
      latitude: -31.53709,
      longitude: -68.52518,
      address: {
        city: 'San Juan',
        stateDistrict: 'Capital',
        country: 'Argentina',
        countryCode: 'AR',
      },
    });
    osmPlacesService.lookupDestinationBoundary.mockResolvedValue({
      status: 'success',
      value: null,
    });

    const result = await service.resolveDestination('San Juan, Argentina', {
      latitude: -31.535107,
      longitude: -68.538594,
    });

    expect(result).toMatchObject({
      scale: 'point',
      settlementResult: { osmId: 198421467 },
      degradationReason: 'boundary_unavailable',
    });
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

  it('normalizes Rosario when a nearby same-name road is not the selected city point', async () => {
    nominatimApi.search.mockResolvedValueOnce([
      {
        osmType: 'way',
        osmId: 23633086,
        addresstype: 'road',
        displayName:
          'Puente Nuestra Señora del Rosario, Municipio de Rosario, Entre Ríos, Argentina',
        importance: 0.05,
        latitude: -32.8680194,
        longitude: -60.6698382,
      },
    ]);
    nominatimApi.reverse.mockResolvedValue({
      osmType: 'relation',
      osmId: 3594027,
      addresstype: 'city',
      displayName: 'Rosario, Municipio de Rosario, Santa Fe, Argentina',
      importance: 0.64,
      latitude: -32.9593609,
      longitude: -60.6617024,
      address: { city: 'Rosario', country: 'Argentina', countryCode: 'AR' },
    });
    nominatimApi.search.mockResolvedValueOnce([
      {
        osmType: 'relation',
        osmId: 3594027,
        addresstype: 'city',
        displayName: 'Rosario, Municipio de Rosario, Santa Fe, Argentina',
        importance: 0.64,
        latitude: -32.9593609,
        longitude: -60.6617024,
        address: { city: 'Rosario', country: 'Argentina', countryCode: 'AR' },
      },
    ]);
    const boundary = {
      id: 'osm:relation:3594027',
      name: 'Rosario',
      osmType: 'relation' as const,
      osmId: 3594027,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-60.8, -33.1],
            [-60.5, -33.1],
            [-60.5, -32.8],
            [-60.8, -33.1],
          ],
        ],
      },
      tags: { name: 'Rosario', admin_level: '8' },
    };
    osmPlacesService.getBoundaryById.mockResolvedValue(boundary);

    const result = await service.resolveDestination(
      'Rosario, Santa Fe Province, Argentina',
      { latitude: -32.9587022, longitude: -60.6930416 },
    );

    expect(nominatimApi.reverse).toHaveBeenCalledWith(-32.9587022, -60.6930416);
    expect(nominatimApi.search).toHaveBeenNthCalledWith(
      2,
      'Rosario, Argentina',
    );
    expect(result).toMatchObject({
      scale: 'area',
      boundary,
      attemptedQueries: [
        'forward:Rosario, Santa Fe Province, Argentina',
        'reverse:-32.958702,-60.693042',
        'forward:Rosario, Argentina',
      ],
      selectedResult: { osmId: 3594027 },
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
