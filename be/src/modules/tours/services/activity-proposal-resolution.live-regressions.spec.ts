import { ActivityProposalResolutionService } from './activity-proposal-resolution.service';
import { ActivityProposal } from '../interfaces/activity-discovery.interface';
import { ProposalResolutionRequest } from '../interfaces/proposal-resolution.interface';
import { OsmCandidate } from '@integrations/osm/services/osm-places.service';

const DESTINATION: OsmCandidate = {
  id: 'osm:relation:1',
  name: 'Gualeguaychú',
  osmType: 'relation',
  osmId: 1,
  tags: { name: 'Gualeguaychú', admin_level: '8' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-58.0, -33.2],
        [-58.0, -32.8],
        [-58.8, -32.8],
        [-58.8, -33.2],
        [-58.0, -33.2],
      ],
    ],
  },
};

function createService() {
  const placesApi = {
    provider: 'geoapify',
    searchText: jest.fn().mockResolvedValue({ data: [] }),
  };
  const osmPlacesService = {
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
  const catalogCandidateValidator = {
    validate: jest
      .fn()
      .mockReturnValue({ accepted: true, rejectionReasons: [] }),
  };

  const service = new ActivityProposalResolutionService(
    placesApi as any,
    osmPlacesService as any,
    catalogCandidateValidator as any,
  );

  return { service, placesApi, osmPlacesService };
}

function request(proposals: ActivityProposal[]): ProposalResolutionRequest {
  return {
    proposals,
    destinationName: 'Gualeguaychú',
    destinationCountry: 'Argentina',
    destinationBoundary: DESTINATION,
  };
}

describe('ActivityProposalResolutionService live regressions', () => {
  it('resolves Paseo Costanera when exactly one coherent OSM route candidate exists', async () => {
    const { service, osmPlacesService } = createService();
    osmPlacesService.lookupStreetsWithin.mockResolvedValue({
      status: 'success',
      value: [
        {
          id: 'osm:way:10',
          name: 'Costanera',
          osmType: 'way',
          osmId: 10,
          tags: { name: 'Costanera', highway: 'pedestrian' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-58.52, -33.01],
              [-58.51, -33.02],
            ],
          },
        },
      ],
    });

    const proposal: ActivityProposal = {
      name: 'Paseo Costanera Waterfront Route',
      kind: 'ROUTE',
      themes: ['nature'],
      entityHints: [
        {
          key: 'route-1',
          name: 'Paseo Costanera',
          role: 'route',
          expectedType: 'Promenade',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      suggestedDurationMinutes: 90,
      shortReason: 'A real waterfront promenade.',
      evidenceKeys: ['ev-1'],
    };

    const result = await service.resolve(request([proposal]));
    expect(result.acceptedCount).toBe(1);
    expect(result.resolved[0].persistedActivityId).toBeUndefined();
    expect(result.resolved[0].resolvedEntities[0]).toEqual(
      expect.objectContaining({
        status: 'resolved',
        provider: 'osm',
        externalId: 'osm:way:10',
      }),
    );
  });

  it('resolves a venue-centric named beach through OSM when Places has no exact match', async () => {
    const { service, placesApi, osmPlacesService } = createService();
    placesApi.searchText.mockResolvedValue({
      data: [
        {
          id: 'wrong-place',
          displayName: { text: 'Another Beach' },
          name: 'Another Beach',
        },
      ],
    });
    osmPlacesService.lookupPoisWithin.mockResolvedValue({
      status: 'success',
      value: [
        {
          id: 'osm:way:20',
          name: 'Balneario Nandubaysal',
          osmType: 'way',
          osmId: 20,
          tags: { name: 'Balneario Nandubaysal', natural: 'beach' },
          geometry: {
            type: 'Point',
            coordinates: [-58.54, -33.03],
          },
        },
      ],
    });

    const proposal: ActivityProposal = {
      name: 'Balneario Nandubaysal Beach and Nature Retreat',
      kind: 'EXPERIENCE',
      themes: ['nature'],
      entityHints: [
        {
          key: 'beach-1',
          name: 'Balneario Nandubaysal',
          role: 'venue',
          expectedType: 'Beach',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      suggestedDurationMinutes: 180,
      shortReason: 'A venue-centric beach experience.',
      evidenceKeys: ['ev-1'],
    };

    const result = await service.resolve(request([proposal]));
    expect(result.acceptedCount).toBe(1);
    expect(result.resolved[0].resolvedEntities[0]).toEqual(
      expect.objectContaining({
        canonicalName: 'Balneario Nandubaysal',
        provider: 'osm',
        status: 'resolved',
      }),
    );
  });

  it('does not guess which Costanera is intended when multiple route candidates match', async () => {
    const { service, osmPlacesService } = createService();
    osmPlacesService.lookupStreetsWithin.mockResolvedValue({
      status: 'success',
      value: [
        {
          id: 'osm:way:10',
          name: 'Costanera Norte',
          osmType: 'way',
          osmId: 10,
          tags: { highway: 'secondary' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-58.52, -33.01],
              [-58.51, -33.02],
            ],
          },
        },
        {
          id: 'osm:way:11',
          name: 'Costanera Sur',
          osmType: 'way',
          osmId: 11,
          tags: { highway: 'residential' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-58.51, -33.02],
              [-58.5, -33.03],
            ],
          },
        },
      ],
    });

    const proposal: ActivityProposal = {
      name: 'Paseo Costanera',
      kind: 'ROUTE',
      themes: ['nature'],
      entityHints: [
        {
          key: 'route-1',
          name: 'Costanera',
          role: 'route',
          expectedType: 'Promenade',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
      suggestedDurationMinutes: 90,
      shortReason: 'A waterfront route.',
      evidenceKeys: ['ev-1'],
    };

    const result = await service.resolve(request([proposal]));
    expect(result.resolved[0].status).toBe('rejected');
    expect(result.resolved[0].rejectionReasons).toContain('ambiguous_route');
  });
});
