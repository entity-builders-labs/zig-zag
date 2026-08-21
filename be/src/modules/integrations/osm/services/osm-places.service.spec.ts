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
      queryStreets: jest.fn(),
      queryBoundaryById: jest.fn(),
      queryAdminBoundariesWithinArea: jest.fn(),
      queryStreetsWithinArea: jest.fn(),
      queryPoisWithinArea: jest.fn(),
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

  describe('findStreetsNear', () => {
    it('maps Overpass ways into OsmCandidate[]', async () => {
      const way: OverpassElement = {
        type: 'way',
        id: 829393,
        tags: { name: 'Defensa', highway: 'pedestrian' },
        geometry: [
          { lat: -34.62, lon: -58.37 },
          { lat: -34.621, lon: -58.371 },
        ],
      };
      overpassApi.queryStreets.mockResolvedValue([way]);

      const result = await service.findStreetsNear(-34.62, -58.37, 2000);

      expect(result).toEqual([
        expect.objectContaining({
          id: 'osm:way:829393',
          name: 'Defensa',
          osmType: 'way',
          osmId: 829393,
        }),
      ]);
    });

    it('drops elements without a usable name or geometry', async () => {
      const noName: OverpassElement = {
        type: 'way',
        id: 1,
        tags: {},
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 1, lon: 1 },
        ],
      };
      const noGeometry: OverpassElement = {
        type: 'way',
        id: 2,
        tags: { name: 'Ghost street' },
        geometry: [],
      };
      overpassApi.queryStreets.mockResolvedValue([noName, noGeometry]);

      const result = await service.findStreetsNear(0, 0, 1000);

      expect(result).toEqual([]);
    });

    it('returns an empty array (not a throw) when Overpass fails', async () => {
      overpassApi.queryStreets.mockRejectedValue(new Error('overpass down'));

      const result = await service.findStreetsNear(0, 0, 1000);

      expect(result).toEqual([]);
    });

    it('returns an empty array when there are no results', async () => {
      overpassApi.queryStreets.mockResolvedValue([]);

      const result = await service.findStreetsNear(0, 0, 1000);

      expect(result).toEqual([]);
    });

    it('caps the radius passed to Overpass instead of inheriting the tour-wide radius', async () => {
      overpassApi.queryStreets.mockResolvedValue([]);
      service = await setup({ OVERPASS_MAX_RADIUS_METERS: '2500' });

      await service.findStreetsNear(0, 0, 50000); // e.g. a tour's full search radius

      expect(overpassApi.queryStreets).toHaveBeenCalledWith(
        expect.objectContaining({ radiusMeters: 2500 }),
      );
    });

    it('passes the radius through unchanged when it is already under the cap', async () => {
      overpassApi.queryStreets.mockResolvedValue([]);
      service = await setup({ OVERPASS_MAX_RADIUS_METERS: '2500' });

      await service.findStreetsNear(0, 0, 800);

      expect(overpassApi.queryStreets).toHaveBeenCalledWith(
        expect.objectContaining({ radiusMeters: 800 }),
      );
    });
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
    });

    it('returns an empty array (not a throw) when Overpass fails', async () => {
      overpassApi.queryAdminBoundariesWithinArea.mockRejectedValue(
        new Error('down'),
      );

      const result = await service.findNeighborhoodsWithin(cityBoundary);

      expect(result).toEqual([]);
    });
  });

  describe('findStreetsWithin', () => {
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

    it('maps named ways within the area into OsmCandidate[], falling back to their center (out tags center has no line geometry)', async () => {
      overpassApi.queryStreetsWithinArea.mockResolvedValue([
        {
          type: 'way',
          id: 47521387,
          tags: { name: 'Defensa', highway: 'pedestrian' },
          center: { lat: -34.621, lon: -58.371 },
        },
      ]);

      const result = await service.findStreetsWithin(neighborhood);

      expect(result).toEqual([
        expect.objectContaining({
          id: 'osm:way:47521387',
          name: 'Defensa',
          geometry: { type: 'Point', coordinates: [-58.371, -34.621] },
        }),
      ]);
    });

    it('returns an empty array (not a throw) when Overpass fails', async () => {
      overpassApi.queryStreetsWithinArea.mockRejectedValue(new Error('down'));

      const result = await service.findStreetsWithin(neighborhood);

      expect(result).toEqual([]);
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

      expect(result).toEqual([]);
    });
  });
});
