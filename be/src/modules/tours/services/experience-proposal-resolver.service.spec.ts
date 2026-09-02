import { GeoEntityKind } from '@prisma/client';
import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';

describe('ExperienceProposalResolverService', () => {
  const boundary: any = {
    id: 'osm:relation:1',
    name: 'Test City',
    osmType: 'relation',
    osmId: 1,
    geometry: {
      type: 'Polygon',
      coordinates: [[[-58.5, -34.6], [-58.4, -34.6], [-58.4, -34.5], [-58.5, -34.6]]],
    },
    tags: { boundary: 'administrative' },
  };

  it('uses destinationBoundary from the canonical request object', async () => {
    const osmPlaces = {
      findStreetsWithin: jest.fn().mockResolvedValue([]),
      findPoisWithin: jest.fn().mockResolvedValue([
        {
          id: 'osm:node:10',
          name: 'Museum',
          osmType: 'node',
          osmId: 10,
          geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
          tags: { tourism: 'museum' },
        },
      ]),
    };
    const catalog = {
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
      persistVerifiedExperience: jest.fn().mockResolvedValue({ id: 'exp-10' }),
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
      proposals: [
        {
          name: 'Visit Museum',
          themes: ['culture'],
          traits: [],
          componentHints: undefined as any,
          entityHints: [
            {
              key: 'museum',
              name: 'Museum',
              role: 'venue',
              expectedType: 'Museum',
              required: true,
              evidenceKeys: ['ev-1'],
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'A real museum visit',
        },
      ],
    });

    expect(osmPlaces.findPoisWithin).toHaveBeenCalledWith(boundary);
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
    const service = new ExperienceProposalResolverService({} as any, {} as any, {} as any);
    await expect(service.resolve({ proposals: [], destinationBoundary: undefined })).rejects.toThrow(
      'Experience resolution requires destinationBoundary',
    );
  });
});
