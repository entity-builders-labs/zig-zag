import { Test, TestingModule } from '@nestjs/testing';
import { DestinationResolutionService } from './destination-resolution.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { pointRadiusToGeometry } from '../utils/geometry-search-area.util';
import { geometryContainsPoint } from '@integrations/osm/utils/geojson-containment.util';

describe('Destination geography regressions', () => {
  it('selects the coordinate-consistent Sevilla boundary instead of an ambiguous same-name result', async () => {
    const nominatimApi = {
      search: jest.fn().mockResolvedValue([
        {
          osmType: 'relation',
          osmId: 999,
          addresstype: 'city',
          placeRank: 16,
          class: 'boundary',
          type: 'administrative',
          displayName: 'Sevilla, unrelated result',
          importance: 0.95,
          latitude: 18.48,
          longitude: -69.94,
          address: { countryCode: 'DO' },
        },
        {
          osmType: 'relation',
          osmId: 349008,
          addresstype: 'city',
          placeRank: 16,
          class: 'boundary',
          type: 'administrative',
          displayName: 'Sevilla, Andalucía, España',
          importance: 0.8,
          latitude: 37.3886,
          longitude: -5.9823,
          address: { countryCode: 'ES' },
        },
      ]),
      reverse: jest.fn(),
    };
    const sevillaBoundary = {
      id: 'osm:relation:349008',
      name: 'Sevilla',
      osmType: 'relation' as const,
      osmId: 349008,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-6.05, 37.32],
            [-5.9, 37.32],
            [-5.9, 37.46],
            [-6.05, 37.46],
            [-6.05, 37.32],
          ],
        ],
      },
      tags: { name: 'Sevilla', admin_level: '8' },
    };
    const osmPlacesService = {
      lookupBoundaryById: jest.fn().mockImplementation((type, id) => ({
        status: 'success',
        value: type === 'relation' && id === 349008 ? sevillaBoundary : null,
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
    const service = module.get(DestinationResolutionService);

    const result = await service.resolveDestination('Sevilla', {
      latitude: 37.3891,
      longitude: -5.9845,
    });

    expect(result.scale).toBe('area');
    if (result.scale !== 'area') throw new Error('Expected area resolution');
    expect(result.boundary.osmId).toBe(349008);
    expect(osmPlacesService.lookupBoundaryById).toHaveBeenCalledWith(
      'relation',
      349008,
    );
    expect(osmPlacesService.lookupBoundaryById).not.toHaveBeenCalledWith(
      'relation',
      999,
    );
  });

  it('keeps point-radius as an auditable synthetic polygon containing the selected point', () => {
    const latitude = -34.639;
    const longitude = -58.362;
    const geometry = pointRadiusToGeometry(latitude, longitude, 1200, 32);

    expect(geometry.type).toBe('Polygon');
    if (geometry.type !== 'Polygon') throw new Error('Expected polygon');
    expect(geometry.coordinates[0]).toHaveLength(33);
    expect(geometry.coordinates[0][0]).toEqual(
      geometry.coordinates[0][geometry.coordinates[0].length - 1],
    );
    expect(geometryContainsPoint(geometry, longitude, latitude)).toBe(true);
  });
});
