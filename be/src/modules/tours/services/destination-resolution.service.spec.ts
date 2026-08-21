import { Test, TestingModule } from '@nestjs/testing';
import { ActivityKind } from '@prisma/client';
import { DestinationResolutionService } from './destination-resolution.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';

describe('DestinationResolutionService', () => {
  let service: DestinationResolutionService;
  let nominatimApi: { search: jest.Mock };
  let osmPlacesService: { getBoundaryById: jest.Mock };
  let compositeActivityService: { resolveArea: jest.Mock };

  beforeEach(async () => {
    nominatimApi = { search: jest.fn() };
    osmPlacesService = { getBoundaryById: jest.fn() };
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

    expect(result).toEqual({ scale: 'area', areaActivity, boundary });
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

      expect(result).toEqual({ scale: 'point' });
      expect(osmPlacesService.getBoundaryById).not.toHaveBeenCalled();
    },
  );

  it('falls back to point-scale when Nominatim returns nothing', async () => {
    nominatimApi.search.mockResolvedValue([]);

    const result = await service.resolveDestination('123 Main St');

    expect(result).toEqual({ scale: 'point' });
  });

  it('falls back to point-scale when no destination text is given', async () => {
    const result = await service.resolveDestination(undefined);

    expect(result).toEqual({ scale: 'point' });
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

    expect(result).toEqual({ scale: 'point' });
  });

  it('falls back to point-scale (never throws) when Nominatim itself fails', async () => {
    nominatimApi.search.mockRejectedValue(new Error('network down'));

    const result = await service.resolveDestination('Buenos Aires');

    expect(result).toEqual({ scale: 'point' });
  });
});
