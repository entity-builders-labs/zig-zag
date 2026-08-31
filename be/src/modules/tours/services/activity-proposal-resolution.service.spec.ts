import { Test, TestingModule } from '@nestjs/testing';
import { ActivityProposalResolutionService } from './activity-proposal-resolution.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { CatalogCandidateValidatorService } from '@activities/services/catalog-candidate-validator.service';
import { ActivityProposal } from '../interfaces/activity-discovery.interface';
import { ProposalResolutionRequest } from '../interfaces/proposal-resolution.interface';
import {
  BUENOS_AIRES_BOUNDARY,
  SAN_TELMO_BOUNDARY,
  LA_BOCA_BOUNDARY,
  OTHER_CITY_SAN_TELMO_BOUNDARY,
  POINT_IN_SAN_TELMO,
} from '@integrations/osm/fixtures/osm-membership.fixture';

describe('ActivityProposalResolutionService', () => {
  let service: ActivityProposalResolutionService;
  let placesApi: any;
  let osmPlacesService: any;

  const defaultPoint = {
    latitude: POINT_IN_SAN_TELMO.latitude,
    longitude: POINT_IN_SAN_TELMO.longitude,
  };

  function place(overrides: any = {}) {
    return {
      id: 'place-1',
      displayName: { text: 'Museo de San Telmo' },
      name: 'Museo de San Telmo',
      location: defaultPoint,
      types: ['museum'],
      primaryType: 'museum',
      rating: 4.5,
      userRatingCount: 200,
      formattedAddress: 'Defensa 800, San Telmo, Buenos Aires',
      ...overrides,
    };
  }

  function street(overrides: any = {}) {
    return {
      id: 'osm:way:123',
      name: 'Defensa',
      osmType: 'way',
      osmId: 123,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-58.37, -34.62],
          [-58.36, -34.62],
        ],
      },
      tags: { name: 'Defensa', highway: 'residential' },
      ...overrides,
    };
  }

  function proposal(
    overrides: Partial<ActivityProposal> = {},
  ): ActivityProposal {
    return {
      name: 'Museo de San Telmo',
      kind: 'POI',
      themes: ['culture'],
      entityHints: [
        {
          key: 'hint-1',
          name: 'Museo de San Telmo',
          role: 'venue',
          expectedType: 'museum',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      suggestedDurationMinutes: 60,
      shortReason: 'A landmark museum',
      evidenceKeys: ['ev-1'],
      ...overrides,
    };
  }

  function request(proposals: ActivityProposal[]): ProposalResolutionRequest {
    return {
      proposals,
      destinationName: 'Buenos Aires',
      destinationCountry: 'Argentina',
      destinationBoundary: BUENOS_AIRES_BOUNDARY,
    };
  }

  beforeEach(async () => {
    placesApi = {
      provider: 'google',
      searchText: jest.fn().mockResolvedValue({ data: [] }),
    };
    osmPlacesService = {
      lookupNeighborhoodsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      findBoundaryByName: jest.fn().mockResolvedValue(null),
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityProposalResolutionService,
        CatalogCandidateValidatorService,
        { provide: 'PlacesApiService', useValue: placesApi },
        { provide: OsmPlacesService, useValue: osmPlacesService },
      ],
    }).compile();
    service = module.get(ActivityProposalResolutionService);
  });

  it('rejects when no destination boundary is supplied', async () => {
    const result = await service.resolve({
      proposals: [proposal()],
      destinationName: 'Buenos Aires',
    });
    expect(result.rejectedCount).toBe(1);
    expect(result.resolved[0].rejectionReasons).toContain(
      'missing_destination_boundary',
    );
  });

  it('resolves a POI to provider evidence without persisting an Activity', async () => {
    placesApi.searchText.mockResolvedValue({ data: [place()] });
    const result = await service.resolve(request([proposal()]));
    expect(result.resolved[0].status).toBe('accepted');
    expect(result.resolved[0].persistedActivityId).toBeUndefined();
    expect(result.resolved[0].resolvedEntities[0]).toEqual(
      expect.objectContaining({
        status: 'resolved',
        provider: 'google',
        externalId: 'place-1',
        canonicalName: 'Museo de San Telmo',
      }),
    );
  });

  it('resolves an AREA proposal without materializing it', async () => {
    osmPlacesService.lookupNeighborhoodsWithin.mockResolvedValue({
      status: 'success',
      value: [SAN_TELMO_BOUNDARY, LA_BOCA_BOUNDARY],
    });
    const areaProposal = proposal({
      name: 'San Telmo area',
      kind: 'AREA',
      entityHints: [
        {
          key: 'area-1',
          name: 'San Telmo',
          role: 'area',
          expectedType: 'neighborhood',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    });
    const result = await service.resolve(request([areaProposal]));
    expect(result.resolved[0].status).toBe('accepted');
    expect(result.resolved[0].persistedActivityId).toBeUndefined();
    expect(result.resolved[0].resolvedEntities[0].geometry).toBeDefined();
  });

  it('does not resolve a homonymous area outside the destination', async () => {
    osmPlacesService.findBoundaryByName.mockResolvedValue(
      OTHER_CITY_SAN_TELMO_BOUNDARY,
    );
    const areaProposal = proposal({
      name: 'San Telmo area',
      kind: 'AREA',
      entityHints: [
        {
          key: 'area-1',
          name: 'San Telmo',
          role: 'area',
          expectedType: 'neighborhood',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    });
    const result = await service.resolve(request([areaProposal]));
    expect(result.resolved[0].status).toBe('rejected');
    expect(result.resolved[0].rejectionReasons).toContain('unresolved_area');
  });

  it('does not require an area hint for EXPERIENCE', async () => {
    placesApi.searchText.mockResolvedValue({ data: [place()] });
    const experience = proposal({
      name: 'Historic cafe experience',
      kind: 'EXPERIENCE',
      entityHints: [
        {
          key: 'venue-1',
          name: 'Museo de San Telmo',
          role: 'venue',
          expectedType: 'museum',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    });
    const result = await service.resolve(request([experience]));
    expect(result.resolved[0].status).toBe('accepted');
    expect(result.resolved[0].rejectionReasons).not.toContain(
      'missing_required_area_hint',
    );
  });

  it('does not require a canonical route hint for a component-defined ROUTE', async () => {
    placesApi.searchText.mockResolvedValue({ data: [place()] });
    const route = proposal({
      name: 'Thematic route',
      kind: 'ROUTE',
      entityHints: [
        {
          key: 'venue-1',
          name: 'Museo de San Telmo',
          role: 'venue',
          expectedType: 'museum',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    });
    const result = await service.resolve(request([route]));
    expect(result.resolved[0].status).toBe('accepted');
    expect(result.resolved[0].rejectionReasons).not.toContain(
      'missing_required_route_hint',
    );
  });

  it('resolves a route-like hint to canonical OSM geometry', async () => {
    osmPlacesService.lookupStreetsWithin.mockResolvedValue({
      status: 'success',
      value: [street()],
    });
    const route = proposal({
      name: 'Defensa route',
      kind: 'ROUTE',
      entityHints: [
        {
          key: 'route-1',
          name: 'Defensa',
          role: 'route',
          expectedType: 'Street',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    });
    const result = await service.resolve(request([route]));
    expect(result.resolved[0].resolvedEntities[0]).toEqual(
      expect.objectContaining({
        status: 'resolved',
        provider: 'osm',
        geometry: street().geometry,
      }),
    );
  });

  it('keeps ambiguous route resolution as evidence failure rather than picking first', async () => {
    osmPlacesService.lookupStreetsWithin.mockResolvedValue({
      status: 'success',
      value: [street(), street({ id: 'osm:way:124', osmId: 124 })],
    });
    const route = proposal({
      kind: 'ROUTE',
      entityHints: [
        {
          key: 'route-1',
          name: 'Defensa',
          role: 'route',
          expectedType: 'Street',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    });
    const result = await service.resolve(request([route]));
    expect(result.resolved[0].status).toBe('rejected');
    expect(result.resolved[0].rejectionReasons).toContain('ambiguous_route');
  });

  it('distinguishes provider failure from a genuine unresolved entity', async () => {
    placesApi.searchText.mockRejectedValue(new Error('quota'));
    osmPlacesService.lookupPoisWithin.mockResolvedValue({
      status: 'failed',
      value: [],
      failureReason: 'Overpass timeout',
    });
    const result = await service.resolve(request([proposal()]));
    expect(result.resolved[0].resolvedEntities[0]).toEqual(
      expect.objectContaining({
        status: 'unresolved',
        providerFailure: true,
        rejectionReason: 'provider_unavailable',
      }),
    );
  });
});
