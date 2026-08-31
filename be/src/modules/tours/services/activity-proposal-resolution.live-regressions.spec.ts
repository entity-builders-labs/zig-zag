import { ActivityKind } from '@prisma/client';
import { ActivityProposalResolutionService } from './activity-proposal-resolution.service';
import { ActivityProposal } from '../interfaces/activity-discovery.interface';

const DESTINATION = {
  id: 'osm:relation:1',
  name: 'Gualeguaychú',
  osmType: 'relation' as const,
  osmId: 1,
  tags: { name: 'Gualeguaychú', admin_level: '8' },
  geometry: {
    type: 'Polygon' as const,
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
    findNeighborhoodsWithin: jest.fn().mockResolvedValue([]),
    findBoundaryByName: jest.fn().mockResolvedValue(null),
    findStreetsWithin: jest.fn().mockResolvedValue([]),
    findPoisWithin: jest.fn().mockResolvedValue([]),
  };
  const osmMembershipService = {
    membershipOf: jest.fn().mockReturnValue({ outcome: 'inside' }),
  };
  const compositeActivityService = {
    resolveArea: jest.fn(),
    createOrReuseComposite: jest.fn().mockResolvedValue({
      id: 'composite-1',
      kind: ActivityKind.EXPERIENCE,
    }),
  };
  const catalogCandidateValidator = {
    validate: jest.fn().mockReturnValue({ accepted: true, rejectionReasons: [] }),
  };
  const prisma = {
    source: {
      findUnique: jest.fn().mockResolvedValue({ id: 'source-1' }),
      create: jest.fn(),
    },
    activity: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: `activity-${data.externalId}`,
        ...data,
      })),
    },
  };
  const vectorStoreService = {
    saveActivityEmbedding: jest.fn().mockResolvedValue({ status: 'indexed' }),
  };

  const service = new ActivityProposalResolutionService(
    placesApi as any,
    osmPlacesService as any,
    osmMembershipService as any,
    compositeActivityService as any,
    catalogCandidateValidator as any,
    prisma as any,
    vectorStoreService as any,
  );

  return {
    service,
    placesApi,
    osmPlacesService,
    compositeActivityService,
    prisma,
  };
}

function request(proposals: ActivityProposal[]) {
  return {
    proposals,
    destinationName: 'Gualeguaychú',
    destinationCountry: 'Argentina',
    destinationBoundary: DESTINATION,
  };
}

describe('ActivityProposalResolutionService live regressions', () => {
  it('resolves Paseo Costanera against an OSM route named Costanera', async () => {
    const { service, osmPlacesService, compositeActivityService } =
      createService();
    osmPlacesService.findStreetsWithin.mockResolvedValue([
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
    ]);

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
    expect(result.resolved[0].rejectionReasons).not.toContain(
      'route_geometry_missing',
    );
    expect(compositeActivityService.createOrReuseComposite).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: ActivityKind.ROUTE,
        waypointIds: ['osm:way:10'],
      }),
    );
  });

  it('resolves a named beach through OSM when Places has no exact match', async () => {
    const { service, placesApi, osmPlacesService, prisma } = createService();
    placesApi.searchText.mockResolvedValue({
      data: [
        {
          id: 'wrong-place',
          displayName: { text: 'Another Beach' },
          name: 'Another Beach',
        },
      ],
    });
    osmPlacesService.findPoisWithin.mockResolvedValue([
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
    ]);

    const proposal: ActivityProposal = {
      name: 'Balneario Nandubaysal Beach and Nature Retreat',
      kind: 'EXPERIENCE',
      themes: ['nature'],
      entityHints: [
        {
          key: 'beach-1',
          name: 'Balneario Nandubaysal',
          role: 'waypoint',
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
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Balneario Nandubaysal',
          kind: ActivityKind.POI,
          externalId: 'osm:way:20',
        }),
      }),
    );
    expect(prisma.activity.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalId: 'wrong-place' }),
      }),
    );
  });
});
