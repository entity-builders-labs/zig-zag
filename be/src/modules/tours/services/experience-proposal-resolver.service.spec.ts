import { GeoEntityKind } from '@prisma/client';
import { ExperienceCandidate } from '../interfaces/experience-discovery.interface';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';

describe('ExperienceProposalResolverService', () => {
  const boundary: any = {
    id: 'osm:relation:1',
    name: 'Test City',
    osmType: 'relation',
    osmId: 1,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-58.5, -34.6],
          [-58.4, -34.6],
          [-58.4, -34.5],
          [-58.5, -34.6],
        ],
      ],
    },
    tags: { boundary: 'administrative' },
  };

  const candidate = (name = 'Visit Museum'): ExperienceCandidate => ({
    name,
    themes: ['culture'],
    traits: [],
    componentHints: [
      {
        key: 'museum',
        name: 'Museum',
        role: 'venue',
        expectedKind: 'PLACE',
        required: true,
        evidenceKeys: ['ev-1'],
      },
    ],
    evidenceKeys: ['ev-1'],
    shortReason: 'A real museum visit',
  });

  it('uses destinationBoundary from the canonical request object', async () => {
    const osmPlaces = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:node:10',
            name: 'Museum',
            osmType: 'node',
            osmId: 10,
            geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
            tags: { tourism: 'museum' },
          },
        ],
      }),
    };
    const catalog = {
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-10',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validateBatch: jest.fn().mockReturnValue({
        results: [{ proposalName: 'Visit Museum', accepted: true }],
        acceptedCount: 1,
        rejectedCount: 0,
      }),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces as any,
      catalog as any,
      geographicValidator as any,
    );

    const result = await service.resolve({
      destinationName: 'Test City',
      destinationBoundary: boundary,
      candidates: [candidate()],
    });

    expect(osmPlaces.lookupPoisWithin).toHaveBeenCalledWith(boundary);
    expect(geographicValidator.validateBatch).toHaveBeenCalledWith(
      expect.objectContaining({ resolved: expect.any(Array) }),
      boundary,
    );
    expect(result.acceptedCount).toBe(1);
    expect(result.resolved[0].experienceId).toBe('exp-10');
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: GeoEntityKind.PLACE }),
    );
  });

  it('fails explicitly when destination scope is absent', async () => {
    const service = new ExperienceProposalResolverService(
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(
      service.resolve({ candidates: [], destinationBoundary: undefined }),
    ).rejects.toThrow('Experience resolution requires destinationBoundary');
  });

  it('distinguishes an OSM provider failure from an empty query', async () => {
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'failed',
          value: [],
          failureReason: '504',
        }),
      } as any,
      {} as any,
      {
        validateBatch: jest
          .fn()
          .mockReturnValue({ results: [], acceptedCount: 0, rejectedCount: 0 }),
      } as any,
    );
    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [candidate()],
    });
    expect(result.resolved[0].rejectionReasons).toContain(
      'OSM_PROVIDER_FAILED',
    );
  });

  it('reports OSM_QUERY_EMPTY when the provider succeeded but returned no candidates', async () => {
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
      } as any,
      {} as any,
      {
        validateBatch: jest
          .fn()
          .mockReturnValue({ results: [], acceptedCount: 0, rejectedCount: 0 }),
      } as any,
    );

    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [candidate()],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toContain('OSM_QUERY_EMPTY');
  });

  it('reports NO_OSM_MATCH when OSM returned candidates but none match the required component', async () => {
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:99',
              name: 'Completely Different Place',
              geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
              tags: {},
            },
          ],
        }),
      } as any,
      {} as any,
      {
        validateBatch: jest
          .fn()
          .mockReturnValue({ results: [], acceptedCount: 0, rejectedCount: 0 }),
      } as any,
    );

    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [candidate()],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toContain('NO_OSM_MATCH');
  });

  it('resolves AREA components against the canonical destination boundary and persists an AREA GeoEntity', async () => {
    const catalog = {
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-area-1' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'exp-area-1',
        dedupeDecision: 'NEW',
      }),
    };
    const geographicValidator = {
      validateBatch: jest.fn().mockReturnValue({
        results: [{ proposalName: 'Walk the historic center', accepted: true }],
        acceptedCount: 1,
        rejectedCount: 0,
      }),
    };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
      } as any,
      catalog as any,
      geographicValidator as any,
    );

    const areaCandidate: ExperienceCandidate = {
      name: 'Walk the historic center',
      themes: ['history'],
      traits: [],
      evidenceKeys: ['ev-1'],
      shortReason: 'Area-bound experience',
      componentHints: [
        {
          key: 'historic-center',
          name: 'Test City',
          role: 'area',
          expectedKind: 'AREA',
          required: true,
          evidenceKeys: ['ev-1'],
        },
      ],
    };

    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [areaCandidate],
    });

    expect(result.acceptedCount).toBe(1);
    expect(catalog.upsertGeoEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: GeoEntityKind.AREA,
        externalId: boundary.id,
        geometry: boundary.geometry,
      }),
    );
  });

  it('uses GEOGRAPHIC_VALIDATION_FAILED when a resolved candidate has no validation result', async () => {
    const catalog = {
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
      persistVerifiedExperience: jest.fn(),
    };
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest
          .fn()
          .mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({
          status: 'success',
          value: [
            {
              id: 'osm:node:10',
              name: 'Museum',
              geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
              tags: { tourism: 'museum' },
            },
          ],
        }),
      } as any,
      catalog as any,
      {
        validateBatch: jest.fn().mockReturnValue({
          results: [],
          acceptedCount: 0,
          rejectedCount: 1,
        }),
      } as any,
    );

    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [candidate()],
    });

    expect(result.acceptedCount).toBe(0);
    expect(result.resolved[0].rejectionReasons).toEqual([
      'GEOGRAPHIC_VALIDATION_FAILED',
    ]);
    expect(catalog.persistVerifiedExperience).not.toHaveBeenCalled();
  });
});
