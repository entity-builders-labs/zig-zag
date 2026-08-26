import { Test, TestingModule } from '@nestjs/testing';
import { ActivityKind, VariantTheme } from '@prisma/client';
import { ActivityProposalResolutionService } from './activity-proposal-resolution.service';
import { OsmMembershipService } from '@integrations/osm/services/osm-membership.service';
import { OsmPlacesService } from '@integrations/osm/services/osm-places.service';
import { CompositeActivityService } from '@activities/services/composite-activity.service';
import { PrismaService } from '@core/database/prisma.service';
import { CatalogCandidateValidatorService } from '@activities/services/catalog-candidate-validator.service';
import { VectorStoreService } from '@shared/ai/services/vector-store.service';
import { ActivityProposal } from '../interfaces/activity-discovery.interface';
import { ProposalResolutionRequest } from '../interfaces/proposal-resolution.interface';
import {
  BUENOS_AIRES_BOUNDARY,
  SAN_TELMO_BOUNDARY,
  LA_BOCA_BOUNDARY,
  MONSERRAT_BOUNDARY,
  OTHER_CITY_SAN_TELMO_BOUNDARY,
  POINT_IN_SAN_TELMO,
  POINT_IN_LA_BOCA,
} from '@integrations/osm/fixtures/osm-membership.fixture';

describe('ActivityProposalResolutionService', () => {
  let service: ActivityProposalResolutionService;
  let placesApi: any;
  let osmPlacesService: any;
  let compositeActivityService: any;
  let prisma: any;
  let vectorStoreService: any;

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
      websiteUri: 'https://example.com',
      formattedAddress: 'Defensa 800, San Telmo, Buenos Aires',
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
          evidenceKeys: [],
        },
      ],
      suggestedDurationMinutes: 60,
      shortReason: 'A landmark museum',
      evidenceKeys: [],
      ...overrides,
    };
  }

  function areaProposal(name = 'San Telmo'): ActivityProposal {
    return {
      name: `${name} area`,
      kind: 'AREA',
      themes: ['culture'],
      entityHints: [
        {
          key: 'area-1',
          name,
          role: 'area',
          expectedType: 'neighborhood',
          required: true,
          evidenceKeys: [],
        },
      ],
      suggestedDurationMinutes: 60,
      shortReason: 'A real neighborhood',
      evidenceKeys: [],
    };
  }

  beforeEach(async () => {
    placesApi = {
      provider: 'google',
      getStatus: jest.fn(),
      searchNearby: jest.fn(),
      searchText: jest.fn(),
      getPlaceDetails: jest.fn(),
    };
    osmPlacesService = {
      findNeighborhoodsWithin: jest.fn(),
      findBoundaryByName: jest.fn(),
      findStreetsWithin: jest.fn(),
    };
    compositeActivityService = {
      resolveArea: jest.fn(),
      createOrReuseComposite: jest.fn(),
    };
    prisma = {
      activity: { findUnique: jest.fn(), create: jest.fn() },
      source: { findUnique: jest.fn(), create: jest.fn() },
    };
    vectorStoreService = {
      saveActivityEmbedding: jest
        .fn()
        .mockResolvedValue({ status: 'indexed', indexedIds: [] }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityProposalResolutionService,
        OsmMembershipService,
        CatalogCandidateValidatorService,
        { provide: 'PlacesApiService', useValue: placesApi },
        { provide: OsmPlacesService, useValue: osmPlacesService },
        {
          provide: CompositeActivityService,
          useValue: compositeActivityService,
        },
        { provide: PrismaService, useValue: prisma },
        { provide: VectorStoreService, useValue: vectorStoreService },
      ],
    }).compile();
    service = mod.get(ActivityProposalResolutionService);

    prisma.source.findUnique.mockResolvedValue({ id: 'src-google' });
    prisma.activity.findUnique.mockResolvedValue(null);
    prisma.activity.create.mockImplementation(async ({ data }: any) => ({
      id: `act-${data.externalId}`,
      ...data,
    }));
    compositeActivityService.resolveArea.mockResolvedValue({
      id: 'area-activity',
      kind: ActivityKind.AREA,
      name: 'San Telmo',
    });
    compositeActivityService.createOrReuseComposite.mockResolvedValue({
      id: 'variant-activity',
      kind: ActivityKind.NEIGHBORHOOD_WALK,
      variantTheme: VariantTheme.HISTORY,
      name: 'San Telmo Historic Walk',
    });
  });

  it('rejects every proposal when no destination boundary is supplied', async () => {
    const r = await service.resolve({
      proposals: [areaProposal('San Telmo')],
      destinationName: 'Buenos Aires',
    });
    expect(r.rejectedCount).toBe(1);
    expect(r.resolved[0].rejectionReasons).toContain(
      'missing_destination_boundary',
    );
  });

  it('resolves an AREA proposal to its neighborhood and persists the AREA', async () => {
    osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
      SAN_TELMO_BOUNDARY,
      LA_BOCA_BOUNDARY,
    ]);
    const r = await service.resolve(req([areaProposal('San Telmo')]));
    expect(r.resolved[0].status).toBe('accepted');
    expect(compositeActivityService.resolveArea).toHaveBeenCalledWith(
      SAN_TELMO_BOUNDARY,
    );
  });

  it('cannot resolve a San Telmo proposal to a homonym in another city', async () => {
    osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([]);
    osmPlacesService.findBoundaryByName.mockResolvedValue(
      OTHER_CITY_SAN_TELMO_BOUNDARY,
    );
    const r = await service.resolve(req([areaProposal('San Telmo')]));
    expect(r.resolved[0].status).toBe('rejected');
    expect(r.resolved[0].rejectionReasons).toContain('unresolved_area');
  });

  it('resolves Montserrat -> OSM Monserrat within Buenos Aires', async () => {
    osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
      MONSERRAT_BOUNDARY,
    ]);
    const r = await service.resolve(req([areaProposal('Montserrat')]));
    expect(r.resolved[0].status).toBe('accepted');
    expect(compositeActivityService.resolveArea).toHaveBeenCalledWith(
      MONSERRAT_BOUNDARY,
    );
  });

  it('resolves a POI through Places and persists it', async () => {
    placesApi.searchText.mockResolvedValue({
      data: [place()],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
      },
    });
    const r = await service.resolve(
      req([proposal({ name: 'Museo de San Telmo' })]),
    );
    expect(r.resolved[0].status).toBe('accepted');
    expect(prisma.activity.create).toHaveBeenCalled();
  });

  it('reuses an existing POI', async () => {
    placesApi.searchText.mockResolvedValue({
      data: [place()],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
      },
    });
    prisma.activity.findUnique.mockResolvedValue({
      id: 'existing-place',
      kind: ActivityKind.POI,
      name: 'Museo de San Telmo',
    });
    const r = await service.resolve(
      req([proposal({ name: 'Museo de San Telmo' })]),
    );
    expect(r.resolved[0].status).toBe('accepted');
    expect(r.resolved[0].persistedActivityId).toBe('existing-place');
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  it('indexes the embedding of a newly persisted POI venue', async () => {
    placesApi.searchText.mockResolvedValue({
      data: [place()],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
      },
    });
    await service.resolve(req([proposal({ name: 'Museo de San Telmo' })]));
    expect(vectorStoreService.saveActivityEmbedding).toHaveBeenCalledWith([
      { id: 'act-place-1' },
    ]);
  });

  it('indexes the embedding of a reused existing POI venue too', async () => {
    placesApi.searchText.mockResolvedValue({
      data: [place()],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
      },
    });
    prisma.activity.findUnique.mockResolvedValue({
      id: 'existing-place',
      kind: ActivityKind.POI,
      name: 'Museo de San Telmo',
    });
    await service.resolve(req([proposal({ name: 'Museo de San Telmo' })]));
    expect(vectorStoreService.saveActivityEmbedding).toHaveBeenCalledWith([
      { id: 'existing-place' },
    ]);
  });

  it('does not call embedding indexing when no POI venue was resolved', async () => {
    osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
      SAN_TELMO_BOUNDARY,
    ]);
    await service.resolve(req([areaProposal('San Telmo')]));
    expect(vectorStoreService.saveActivityEmbedding).not.toHaveBeenCalled();
  });

  it('does not fail resolution when embedding indexing throws', async () => {
    placesApi.searchText.mockResolvedValue({
      data: [place()],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 1,
      },
    });
    vectorStoreService.saveActivityEmbedding.mockRejectedValue(
      new Error('embedding service down'),
    );
    const r = await service.resolve(
      req([proposal({ name: 'Museo de San Telmo' })]),
    );
    expect(r.resolved[0].status).toBe('accepted');
  });

  it('rejects a POI proposal with unresolved venue', async () => {
    placesApi.searchText.mockResolvedValue({
      data: [],
      provenance: {
        provider: 'google',
        cacheStatus: 'miss-live',
        requestedCount: 1,
        receivedCount: 0,
      },
    });
    const r = await service.resolve(
      req([proposal({ name: 'Museo de San Telmo' })]),
    );
    expect(r.resolved[0].status).toBe('rejected');
    expect(r.resolved[0].rejectionReasons).toContain('unresolved_venue');
  });

  function walkProposal(
    areaName: string,
    hints: ActivityProposal['entityHints'],
  ): ActivityProposal {
    return {
      name: `${areaName} Historic Walk`,
      kind: 'NEIGHBORHOOD_WALK',
      themes: ['history'],
      entityHints: [
        {
          key: 'area-1',
          name: areaName,
          role: 'area',
          expectedType: 'neighborhood',
          required: true,
          evidenceKeys: [],
        },
        ...hints,
      ],
      suggestedDurationMinutes: 120,
      shortReason: 'A coherent walk',
      evidenceKeys: [],
    };
  }

  function req(proposals: ActivityProposal[]): ProposalResolutionRequest {
    return {
      proposals,
      destinationName: 'Buenos Aires',
      destinationCountry: 'Argentina',
      destinationBoundary: BUENOS_AIRES_BOUNDARY,
    };
  }

  it('accepts a walk whose waypoints are inside its neighborhood', async () => {
    osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
      SAN_TELMO_BOUNDARY,
      LA_BOCA_BOUNDARY,
    ]);
    placesApi.searchText.mockImplementation(
      async ({ textQuery }: { textQuery: string }) => {
        const n = textQuery.split(',')[0].trim();
        return {
          data: [
            place({ id: `place-${n}`, displayName: { text: n }, name: n }),
          ],
          provenance: {
            provider: 'google',
            cacheStatus: 'miss-live',
            requestedCount: 1,
            receivedCount: 1,
          },
        };
      },
    );
    const r = await service.resolve(
      req([
        walkProposal('San Telmo', [
          {
            key: 'wp-1',
            name: 'Museo de San Telmo',
            role: 'waypoint',
            expectedType: 'museum',
            required: false,
            evidenceKeys: [],
          },
          {
            key: 'wp-2',
            name: 'Iglesia de San Telmo',
            role: 'waypoint',
            expectedType: 'church',
            required: false,
            evidenceKeys: [],
          },
        ]),
      ]),
    );
    expect(r.resolved[0].status).toBe('accepted');
    expect(
      compositeActivityService.createOrReuseComposite.mock.calls[0][0]
        .waypointIds,
    ).toHaveLength(2);
  });

  it('cannot mix waypoints from San Telmo and La Boca', async () => {
    osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
      SAN_TELMO_BOUNDARY,
      LA_BOCA_BOUNDARY,
    ]);
    placesApi.searchText.mockImplementation(
      async ({ textQuery }: { textQuery: string }) => {
        const n = textQuery.split(',')[0].trim();
        const loc =
          n === 'Museo La Boca' ? POINT_IN_LA_BOCA : POINT_IN_SAN_TELMO;
        return {
          data: [
            place({
              id: `place-${n}`,
              displayName: { text: n },
              name: n,
              location: loc,
            }),
          ],
          provenance: {
            provider: 'google',
            cacheStatus: 'miss-live',
            requestedCount: 1,
            receivedCount: 1,
          },
        };
      },
    );
    const r = await service.resolve(
      req([
        walkProposal('San Telmo', [
          {
            key: 'wp-1',
            name: 'Museo de San Telmo',
            role: 'waypoint',
            expectedType: 'museum',
            required: false,
            evidenceKeys: [],
          },
          {
            key: 'wp-2',
            name: 'Museo La Boca',
            role: 'waypoint',
            expectedType: 'museum',
            required: false,
            evidenceKeys: [],
          },
        ]),
      ]),
    );
    expect(r.resolved[0].status).toBe('rejected');
    expect(r.resolved[0].rejectionReasons).toContain(
      'waypoint_outside_neighborhood',
    );
  });

  it('materializes an OSM street as ROUTE, never via Places', async () => {
    osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
      SAN_TELMO_BOUNDARY,
      LA_BOCA_BOUNDARY,
    ]);
    osmPlacesService.findStreetsWithin.mockResolvedValue([
      {
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
      },
    ]);
    const r = await service.resolve(
      req([
        {
          name: 'Defensa Street Route',
          kind: 'ROUTE',
          themes: ['photography'],
          entityHints: [
            {
              key: 'area-1',
              name: 'San Telmo',
              role: 'area',
              expectedType: 'neighborhood',
              required: true,
              evidenceKeys: [],
            },
            {
              key: 'route-1',
              name: 'Defensa',
              role: 'route',
              expectedType: 'street',
              required: true,
              evidenceKeys: [],
            },
          ],
          suggestedDurationMinutes: 60,
          shortReason: 'A photo walk',
          evidenceKeys: [],
        },
      ]),
    );
    expect(r.resolved[0].status).toBe('accepted');
    expect(placesApi.searchText).not.toHaveBeenCalled();
    expect(
      compositeActivityService.createOrReuseComposite.mock.calls[0][0].kind,
    ).toBe(ActivityKind.ROUTE);
  });

  it('rejects generic area phrase', async () => {
    const r = await service.resolve(req([areaProposal('downtown')]));
    expect(r.resolved[0].status).toBe('rejected');
    expect(r.resolved[0].rejectionReasons).toContain('generic_area_hint');
  });

  it('rejects a composite with no resolvable theme', async () => {
    osmPlacesService.findNeighborhoodsWithin.mockResolvedValue([
      SAN_TELMO_BOUNDARY,
      LA_BOCA_BOUNDARY,
    ]);
    placesApi.searchText.mockImplementation(
      async ({ textQuery }: { textQuery: string }) => {
        const n = textQuery.split(',')[0].trim();
        return {
          data: [
            place({ id: `place-${n}`, displayName: { text: n }, name: n }),
          ],
          provenance: {
            provider: 'google',
            cacheStatus: 'miss-live',
            requestedCount: 1,
            receivedCount: 1,
          },
        };
      },
    );
    const r = await service.resolve(
      req([
        {
          ...walkProposal('San Telmo', [
            {
              key: 'wp-1',
              name: 'Museo de San Telmo',
              role: 'waypoint',
              expectedType: 'museum',
              required: false,
              evidenceKeys: [],
            },
            {
              key: 'wp-2',
              name: 'Iglesia de San Telmo',
              role: 'waypoint',
              expectedType: 'church',
              required: false,
              evidenceKeys: [],
            },
          ]),
          themes: ['an_unmappable_theme'],
        },
      ]),
    );
    expect(r.resolved[0].status).toBe('rejected');
    expect(r.resolved[0].rejectionReasons).toContain('unresolvable_theme');
  });
});
