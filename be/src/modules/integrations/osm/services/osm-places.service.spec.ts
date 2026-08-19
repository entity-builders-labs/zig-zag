import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OsmPlacesService } from './osm-places.service';
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
});
