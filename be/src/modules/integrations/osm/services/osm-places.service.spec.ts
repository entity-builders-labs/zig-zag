import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OsmCandidate, OsmPlacesService } from './osm-places.service';
import {
  IOverpassApiService,
  OverpassElement,
} from '../interfaces/overpass.interface';

describe('OsmPlacesService', () => {
  let overpassApi: jest.Mocked<IOverpassApiService>;
  let service: OsmPlacesService;

  const setup = async (configOverrides: Record<string, string> = {}) => {
    overpassApi = {
      queryBoundaryByName: jest.fn(),
      queryContainingBoundary: jest.fn(),
      queryBoundaryById: jest.fn(),
      queryAdminBoundariesWithinArea: jest.fn(),
      queryPoisWithinArea: jest.fn(),
      queryPois: jest.fn(),
      queryFeaturesNear: jest.fn(),
      queryHighwaysByName: jest.fn(),
      queryContainingAdminBoundaries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OsmPlacesService,
        { provide: 'OverpassApiService', useValue: overpassApi },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => configOverrides[key]) },
        },
      ],
    }).compile();

    return module.get(OsmPlacesService);
  };

  beforeEach(async () => {
    service = await setup();
  });

  describe('findContainingBoundary', () => {
    const closedRing = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 0, lon: 0 },
    ];

    it('picks the boundary with the most specific admin_level among several candidates', async () => {
      const city: OverpassElement = {
        type: 'relation',
        id: 1,
        tags: { name: 'Buenos Aires', admin_level: '8' },
        members: [{ type: 'way', ref: 1, role: 'outer', geometry: closedRing }],
      };
      const neighborhood: OverpassElement = {
        type: 'relation',
        id: 2,
        tags: { name: 'San Telmo', admin_level: '10' },
        members: [{ type: 'way', ref: 2, role: 'outer', geometry: closedRing }],
      };
      overpassApi.queryContainingBoundary.mockResolvedValue([
        city,
        neighborhood,
      ]);

      const result = await service.findContainingBoundary(-34.62, -58.37);

      expect(result?.name).toBe('San Telmo');
    });

    it('discards candidates whose admin_level is outside the plausible neighborhood range', async () => {
      const country: OverpassElement = {
        type: 'relation',
        id: 1,
        tags: { name: 'Argentina', admin_level: '2' },
        members: [{ type: 'way', ref: 1, role: 'outer', geometry: closedRing }],
      };
      overpassApi.queryContainingBoundary.mockResolvedValue([country]);

      const result = await service.findContainingBoundary(-34.62, -58.37);

      expect(result).toBeNull();
    });

    it('returns null when nothing has a usable admin_level, rather than guessing', async () => {
      const noLevel: OverpassElement = {
        type: 'relation',
        id: 1,
        tags: { name: 'Somewhere' },
        members: [{ type: 'way', ref: 1, role: 'outer', geometry: closedRing }],
      };
      overpassApi.queryContainingBoundary.mockResolvedValue([noLevel]);

      const result = await service.findContainingBoundary(-34.62, -58.37);

      expect(result).toBeNull();
    });

    it('returns null (not a throw) when Overpass fails', async () => {
      overpassApi.queryContainingBoundary.mockRejectedValue(new Error('down'));

      const result = await service.findContainingBoundary(0, 0);

      expect(result).toBeNull();
    });

    it('exposes boundary lookup failure to trace consumers', async () => {
      overpassApi.queryContainingBoundary.mockRejectedValue(new Error('down'));

      await expect(service.lookupContainingBoundary(0, 0)).resolves.toEqual({
        status: 'failed',
        value: null,
        failureReason: 'down',
      });
    });
  });

  describe('lookupDestinationBoundary', () => {
    const closedRing = [
      { lat: -31.57, lon: -68.57 },
      { lat: -31.57, lon: -68.5 },
      { lat: -31.5, lon: -68.5 },
      { lat: -31.57, lon: -68.57 },
    ];

    it('selects the structured administrative container instead of the most specific neighborhood', async () => {
      const province: OverpassElement = {
        type: 'relation',
        id: 153539,
        tags: { name: 'San Juan', admin_level: '4' },
        members: [{ type: 'way', ref: 1, role: 'outer', geometry: closedRing }],
      };
      const capital: OverpassElement = {
        type: 'relation',
        id: 3465536,
        tags: { name: 'Capital', admin_level: '5' },
        members: [{ type: 'way', ref: 2, role: 'outer', geometry: closedRing }],
      };
      const suburb: OverpassElement = {
        type: 'relation',
        id: 19285517,
        tags: { name: 'Desamparados', admin_level: '6' },
        members: [{ type: 'way', ref: 3, role: 'outer', geometry: closedRing }],
      };
      overpassApi.queryContainingBoundary.mockResolvedValue([
        province,
        capital,
        suburb,
      ]);

      const result = await service.lookupDestinationBoundary(
        -31.535107,
        -68.538594,
        ['Capital'],
      );

      expect(result).toEqual({
        status: 'success',
        value: expect.objectContaining({
          osmType: 'relation',
          osmId: 3465536,
          name: 'Capital',
        }),
      });
    });

    it('does not guess a destination boundary from admin level when no structured name matches', async () => {
      overpassApi.queryContainingBoundary.mockResolvedValue([
        {
          type: 'relation',
          id: 19285517,
          tags: { name: 'Desamparados', admin_level: '6' },
          members: [
            { type: 'way', ref: 1, role: 'outer', geometry: closedRing },
          ],
        },
      ]);

      await expect(
        service.lookupDestinationBoundary(-31.535107, -68.538594, ['Capital']),
      ).resolves.toEqual({ status: 'success', value: null });
    });

    it('reports provider failure separately from a successful no-match', async () => {
      overpassApi.queryContainingBoundary.mockRejectedValue(
        new Error('overpass down'),
      );

      await expect(
        service.lookupDestinationBoundary(-31.535107, -68.538594, ['Capital']),
      ).resolves.toEqual({
        status: 'failed',
        value: null,
        failureReason: 'overpass down',
      });
    });
  });

  describe('findBoundaryByName', () => {
    it('returns the first matching candidate', async () => {
      const relation: OverpassElement = {
        type: 'relation',
        id: 5,
        tags: { name: 'San Telmo' },
        members: [
          {
            type: 'way',
            ref: 1,
            role: 'outer',
            geometry: [
              { lat: 0, lon: 0 },
              { lat: 0, lon: 1 },
              { lat: 1, lon: 1 },
              { lat: 0, lon: 0 },
            ],
          },
        ],
      };
      overpassApi.queryBoundaryByName.mockResolvedValue([relation]);

      const result = await service.findBoundaryByName(
        'San Telmo',
        -34.62,
        -58.37,
        3000,
      );

      expect(result?.id).toBe('osm:relation:5');
    });

    it('returns null (not a throw) when Overpass fails', async () => {
      overpassApi.queryBoundaryByName.mockRejectedValue(new Error('down'));

      const result = await service.findBoundaryByName('San Telmo', 0, 0, 1000);

      expect(result).toBeNull();
    });
  });

  describe('getBoundaryById', () => {
    it('maps a resolved relation into an OsmCandidate', async () => {
      const relation: OverpassElement = {
        type: 'relation',
        id: 1224652,
        tags: { name: 'Buenos Aires', admin_level: '8' },
        members: [
          {
            type: 'way',
            ref: 1,
            role: 'outer',
            geometry: [
              { lat: 0, lon: 0 },
              { lat: 0, lon: 1 },
              { lat: 1, lon: 1 },
              { lat: 0, lon: 0 },
            ],
          },
        ],
      };
      overpassApi.queryBoundaryById.mockResolvedValue([relation]);

      const result = await service.getBoundaryById('relation', 1224652);

      expect(result?.id).toBe('osm:relation:1224652');
      expect(result?.tags.admin_level).toBe('8');
    });

    it('returns null (not a throw) when Overpass fails', async () => {
      overpassApi.queryBoundaryById.mockRejectedValue(new Error('down'));

      const result = await service.getBoundaryById('relation', 1);

      expect(result).toBeNull();
    });

    it('returns null when nothing is returned', async () => {
      overpassApi.queryBoundaryById.mockResolvedValue([]);

      const result = await service.getBoundaryById('relation', 1);

      expect(result).toBeNull();
    });
  });

  describe('findNeighborhoodsWithin', () => {
    const cityBoundary: OsmCandidate = {
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

    it('filters to admin_level = city level + 1, relative, not a fixed absolute range', async () => {
      // `out tags center` (buildAdminBoundariesWithinAreaQuery) — no
      // members/geometry, only a lightweight centroid. See osm-geometry.util.ts's
      // center fallback.
      const sanTelmo: OverpassElement = {
        type: 'relation',
        id: 2223069,
        tags: { name: 'San Telmo', admin_level: '9' },
        center: { lat: -34.62, lon: -58.37 },
      };
      const comuna: OverpassElement = {
        type: 'relation',
        id: 4261029,
        tags: { name: 'Comuna 1', admin_level: '5' },
        center: { lat: -34.61, lon: -58.38 },
      };
      const country: OverpassElement = {
        type: 'relation',
        id: 286393,
        tags: { name: 'Argentina', admin_level: '2' },
        center: { lat: -34.0, lon: -64.0 },
      };
      overpassApi.queryAdminBoundariesWithinArea.mockResolvedValue([
        sanTelmo,
        comuna,
        country,
      ]);

      const result = await service.findNeighborhoodsWithin(cityBoundary);

      expect(result.map((c) => c.name)).toEqual(['San Telmo']);
      expect(overpassApi.queryAdminBoundariesWithinArea).toHaveBeenCalledWith({
        osmType: 'relation',
        osmId: 1224652,
        childAdminLevel: 9,
      });
    });

    it('rejects highway ways and duplicate OSM identities while retaining a genuine area way', async () => {
      overpassApi.queryAdminBoundariesWithinArea.mockResolvedValue([
        {
          type: 'relation',
          id: 1,
          tags: { name: 'Centro', admin_level: '9' },
          center: { lat: -34.61, lon: -58.38 },
        },
        {
          type: 'relation',
          id: 1,
          tags: { name: 'Centro duplicate', admin_level: '9' },
          center: { lat: -34.61, lon: -58.38 },
        },
        {
          type: 'way',
          id: 2,
          tags: {
            name: 'Administrative road',
            admin_level: '9',
            highway: 'residential',
          },
          center: { lat: -34.62, lon: -58.39 },
        },
        {
          type: 'way',
          id: 3,
          tags: { name: 'Closed residential area', admin_level: '9' },
          center: { lat: -34.63, lon: -58.4 },
        },
        {
          type: 'node',
          id: 4,
          tags: { name: 'Not a boundary', admin_level: '9' },
          lat: -34.64,
          lon: -58.41,
        },
      ]);

      const result = await service.findNeighborhoodsWithin(cityBoundary);

      expect(result.map(({ id }) => id)).toEqual([
        'osm:relation:1',
        'osm:way:3',
      ]);
    });

    it('returns an empty array (not a throw) when Overpass fails', async () => {
      overpassApi.queryAdminBoundariesWithinArea.mockRejectedValue(
        new Error('down'),
      );

      const result = await service.findNeighborhoodsWithin(cityBoundary);
      const lookup = await service.lookupNeighborhoodsWithin(cityBoundary);

      expect(result).toEqual([]);
      expect(lookup).toMatchObject({
        status: 'failed',
        value: [],
        failureReason: 'down',
      });
    });

    it('marks a missing parent admin level as unavailable instead of an empty success', async () => {
      const lookup = await service.lookupNeighborhoodsWithin({
        ...cityBoundary,
        tags: { name: cityBoundary.name },
      });

      expect(lookup).toMatchObject({
        status: 'failed',
        value: [],
        failureReason: expect.stringMatching(/administrative level/),
      });
      expect(overpassApi.queryAdminBoundariesWithinArea).not.toHaveBeenCalled();
    });
  });

  describe('findPoisWithin', () => {
    const neighborhood: OsmCandidate = {
      id: 'osm:relation:2223069',
      name: 'San Telmo',
      osmType: 'relation' as const,
      osmId: 2223069,
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
      tags: { name: 'San Telmo' },
    };

    it('maps named tourism/historic/etc nodes within the area into OsmCandidate[]', async () => {
      overpassApi.queryPoisWithinArea.mockResolvedValue([
        {
          type: 'node',
          id: 123,
          tags: { name: 'Casa Mínima', historic: 'yes' },
          lat: -34.621,
          lon: -58.371,
        },
      ]);

      const result = await service.findPoisWithin(neighborhood);

      expect(result).toEqual([
        expect.objectContaining({
          id: 'osm:node:123',
          name: 'Casa Mínima',
          geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
        }),
      ]);
    });

    it('returns an empty array (not a throw) when Overpass fails', async () => {
      overpassApi.queryPoisWithinArea.mockRejectedValue(new Error('down'));

      const result = await service.findPoisWithin(neighborhood);
      const lookup = await service.lookupPoisWithin(neighborhood);

      expect(result).toEqual([]);
      expect(lookup).toMatchObject({
        status: 'failed',
        value: [],
        failureReason: 'down',
      });
    });
  });

  describe('lookupFeaturesNear', () => {
    const selectors = [
      { key: 'tourism', value: 'museum', requireName: true },
      { key: 'leisure', value: 'park', requireName: true },
    ];

    it('maps named Overpass elements into OsmCandidate[], drops nameless ones, and exposes rawResultCount', async () => {
      overpassApi.queryFeaturesNear.mockResolvedValue([
        {
          type: 'node',
          id: 1,
          tags: { name: 'Museo Histórico Nacional', tourism: 'museum' },
          lat: -34.62,
          lon: -58.37,
        },
        {
          type: 'way',
          id: 2,
          tags: { leisure: 'park' }, // no name -> dropped by toCandidate
          center: { lat: -34.58, lon: -58.42 },
        },
        {
          type: 'relation',
          id: 3,
          tags: { name: 'Parque Lezama', leisure: 'park' },
          center: { lat: -34.628, lon: -58.369 },
        },
      ]);

      const result = await service.lookupFeaturesNear(
        -34.6,
        -58.38,
        3000,
        selectors,
      );

      expect(result.status).toBe('success');
      expect(result.rawResultCount).toBe(3); // raw Overpass count, pre-filter
      expect(result.value).toEqual([
        expect.objectContaining({ id: 'osm:node:1', osmType: 'node' }),
        expect.objectContaining({ id: 'osm:relation:3', osmType: 'relation' }),
      ]);
      expect(result.value).toHaveLength(2); // candidateCount after filtering
    });

    it('skips elements with a malformed OSM identity but keeps the valid siblings', async () => {
      overpassApi.queryFeaturesNear.mockResolvedValue([
        {
          type: 'node',
          tags: { name: 'No id', tourism: 'museum' },
          lat: -34.6,
          lon: -58.3,
        },
        {
          type: 'node',
          id: Number.NaN,
          tags: { name: 'NaN id', tourism: 'museum' },
          lat: -34.6,
          lon: -58.3,
        },
        {
          type: 'node',
          id: -5,
          tags: { name: 'Negative id', tourism: 'museum' },
          lat: -34.6,
          lon: -58.3,
        },
        {
          type: 'node',
          id: 0,
          tags: { name: 'Zero id', tourism: 'museum' },
          lat: -34.6,
          lon: -58.3,
        },
        {
          type: 'node',
          id: 3.5,
          tags: { name: 'Float id', tourism: 'museum' },
          lat: -34.6,
          lon: -58.3,
        },
        {
          type: 'foo',
          id: 7,
          tags: { name: 'Bad type', tourism: 'museum' },
          lat: -34.6,
          lon: -58.3,
        },
        {
          type: 'node',
          id: 42,
          tags: { name: 'Good', tourism: 'museum' },
          lat: -34.62,
          lon: -58.37,
        },
      ] as any);

      const result = await service.lookupFeaturesNear(
        -34.6,
        -58.38,
        3000,
        selectors,
      );

      expect(result.status).toBe('success');
      expect(result.rawResultCount).toBe(7);
      expect(result.value).toEqual([
        expect.objectContaining({ id: 'osm:node:42', name: 'Good' }),
      ]);
    });

    it('caps the radius to maxFeaturesRadiusMeters before querying Overpass', async () => {
      const cappedService = await setup({
        OVERPASS_MAX_FEATURES_RADIUS_METERS: '4000',
      });
      overpassApi.queryFeaturesNear.mockResolvedValue([]);

      await cappedService.lookupFeaturesNear(-34.6, -58.38, 50000, selectors);

      expect(overpassApi.queryFeaturesNear).toHaveBeenCalledWith(
        expect.objectContaining({ radiusMeters: 4000, selectors }),
      );
    });

    it('returns success with [] (rawResultCount 0) for an empty selector list without calling Overpass', async () => {
      const result = await service.lookupFeaturesNear(-34.6, -58.38, 3000, []);

      expect(result).toEqual({
        status: 'success',
        value: [],
        rawResultCount: 0,
      });
      expect(overpassApi.queryFeaturesNear).not.toHaveBeenCalled();
    });

    it('reports rawResultCount 0 for a successful empty Overpass response', async () => {
      overpassApi.queryFeaturesNear.mockResolvedValue([]);

      const result = await service.lookupFeaturesNear(
        -34.6,
        -58.38,
        3000,
        selectors,
      );

      expect(result).toEqual({
        status: 'success',
        value: [],
        rawResultCount: 0,
      });
    });

    it('degrades to a failed lookup (never throws, rawResultCount 0) when Overpass fails', async () => {
      overpassApi.queryFeaturesNear.mockRejectedValue(
        new Error('overpass 504'),
      );

      const result = await service.lookupFeaturesNear(
        -34.6,
        -58.38,
        3000,
        selectors,
      );

      expect(result).toMatchObject({
        status: 'failed',
        value: [],
        failureReason: 'overpass 504',
        rawResultCount: 0,
      });
    });
  });

  describe('lookupHighwaysByName', () => {
    const params = {
      name: 'Defensa',
      latitude: -34.6037,
      longitude: -58.3816,
      radiusMeters: 20000,
    };
    const line = [
      { lat: -34.625, lon: -58.371 },
      { lat: -34.626, lon: -58.371 },
    ];

    it('normalizes route-compatible highway ways into typed segments', async () => {
      service = await setup();
      overpassApi.queryHighwaysByName.mockResolvedValue([
        {
          type: 'way',
          id: 48113515,
          tags: { highway: 'secondary', name: 'Defensa' },
          nodes: [1, 2],
          geometry: line,
        },
      ]);

      const result = await service.lookupHighwaysByName(params);

      expect(overpassApi.queryHighwaysByName).toHaveBeenCalledWith(params);
      expect(result).toEqual({
        status: 'success',
        value: {
          rawCount: 1,
          segments: [
            {
              externalId: 'osm:way:48113515',
              osmId: 48113515,
              name: 'Defensa',
              highway: 'secondary',
              nodes: [1, 2],
              geometry: line,
            },
          ],
          rejected: [],
        },
      });
    });

    it('rejects non-route objects with explicit structural reasons: nodes, relations, non-highways, highway areas, missing name/geometry, invalid ids', async () => {
      service = await setup();
      overpassApi.queryHighwaysByName.mockResolvedValue([
        {
          type: 'node',
          id: 1,
          lat: -34.62,
          lon: -58.37,
          tags: { highway: 'bus_stop', name: 'Defensa' },
        },
        { type: 'relation', id: 2, tags: { type: 'route', name: 'Defensa' } },
        {
          type: 'way',
          id: 3,
          tags: { building: 'yes', name: 'Defensa' },
          nodes: [1, 2],
          geometry: line,
        },
        {
          type: 'way',
          id: 4,
          tags: { highway: 'pedestrian', area: 'yes', name: 'Defensa' },
          nodes: [1, 2, 3, 1],
          geometry: [...line, { lat: -34.626, lon: -58.372 }, line[0]],
        },
        {
          type: 'way',
          id: 5,
          tags: { highway: 'residential', name: 'Defensa' },
          nodes: [1, 2],
        },
        {
          type: 'way',
          id: 6,
          tags: { highway: 'residential' },
          nodes: [1, 2],
          geometry: line,
        },
        {
          type: 'way',
          id: -7,
          tags: { highway: 'residential', name: 'Defensa' },
          nodes: [1, 2],
          geometry: line,
        },
      ] as OverpassElement[]);

      const result = await service.lookupHighwaysByName(params);

      expect(result.status).toBe('success');
      expect(result.value.segments).toEqual([]);
      expect(result.value.rawCount).toBe(7);
      expect(result.value.rejected.map((r) => r.reason)).toEqual([
        'NOT_A_WAY',
        'NOT_A_WAY',
        'NOT_A_HIGHWAY',
        'HIGHWAY_AREA_NOT_LINEAR',
        'MISSING_GEOMETRY',
        'MISSING_NAME',
        'INVALID_IDENTITY',
      ]);
    });

    it('reports provider failure explicitly instead of an empty success', async () => {
      service = await setup();
      overpassApi.queryHighwaysByName.mockRejectedValue(new Error('timeout'));

      const result = await service.lookupHighwaysByName(params);

      expect(result.status).toBe('failed');
      expect(result.failureReason).toBe('timeout');
    });
  });

  describe('lookupContainingAdminUnits', () => {
    it('normalizes containing admin relations into typed admin units, coarse to fine', async () => {
      service = await setup();
      overpassApi.queryContainingAdminBoundaries.mockResolvedValue([
        {
          type: 'relation',
          id: 2223069,
          tags: {
            boundary: 'administrative',
            admin_level: '9',
            name: 'San Telmo',
          },
        },
        {
          type: 'relation',
          id: 286393,
          tags: {
            boundary: 'administrative',
            admin_level: '2',
            name: 'Argentina',
            'ISO3166-1:alpha2': 'AR',
          },
        },
        {
          type: 'relation',
          id: 3082668,
          tags: {
            boundary: 'administrative',
            admin_level: '4',
            name: 'Ciudad Autónoma de Buenos Aires',
          },
        },
        { type: 'node', id: 9, tags: { name: 'not an admin unit' } },
      ]);

      const result = await service.lookupContainingAdminUnits({
        latitude: -34.62,
        longitude: -58.37,
      });

      expect(overpassApi.queryContainingAdminBoundaries).toHaveBeenCalledWith({
        latitude: -34.62,
        longitude: -58.37,
      });
      expect(result).toEqual({
        status: 'success',
        value: [
          {
            osmType: 'relation',
            osmId: 286393,
            name: 'Argentina',
            adminLevel: 2,
            countryCode: 'AR',
          },
          {
            osmType: 'relation',
            osmId: 3082668,
            name: 'Ciudad Autónoma de Buenos Aires',
            adminLevel: 4,
          },
          {
            osmType: 'relation',
            osmId: 2223069,
            name: 'San Telmo',
            adminLevel: 9,
          },
        ],
      });
    });

    it('reports provider failure explicitly', async () => {
      service = await setup();
      overpassApi.queryContainingAdminBoundaries.mockRejectedValue(
        new Error('down'),
      );

      const result = await service.lookupContainingAdminUnits({
        latitude: -34.62,
        longitude: -58.37,
      });

      expect(result).toEqual({
        status: 'failed',
        value: [],
        failureReason: 'down',
      });
    });
  });
});
