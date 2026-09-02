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
      lookupStreetsWithin: jest.fn().mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({ status: 'success', value: [
        {
          id: 'osm:node:10',
          name: 'Museum',
          osmType: 'node',
          osmId: 10,
          geometry: { type: 'Point', coordinates: [-58.45, -34.55] },
          tags: { tourism: 'museum' },
        },
      ] }),
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
      candidates: [
        {
          name: 'Visit Museum',
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
        },
      ],
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
    const service = new ExperienceProposalResolverService({} as any, {} as any, {} as any);
    await expect(service.resolve({ candidates: [], destinationBoundary: undefined })).rejects.toThrow(
      'Experience resolution requires destinationBoundary',
    );
  });

  it('distinguishes an OSM provider failure from an empty query', async () => {
    const service = new ExperienceProposalResolverService(
      {
        lookupStreetsWithin: jest.fn().mockResolvedValue({ status: 'success', value: [] }),
        lookupPoisWithin: jest.fn().mockResolvedValue({ status: 'failed', value: [], failureReason: '504' }),
      } as any,
      {} as any,
      { validateBatch: jest.fn().mockReturnValue({ results: [], acceptedCount: 0, rejectedCount: 0 }) } as any,
    );
    const result = await service.resolve({
      destinationBoundary: boundary,
      candidates: [{
        name: 'Visit Museum', themes: [], traits: [], componentHints: [{ key: 'museum', name: 'Museum', role: 'venue', expectedKind: 'PLACE', required: true, evidenceKeys: [] }],
        evidenceKeys: [], shortReason: 'test',
      }],
    });
    expect(result.resolved[0].rejectionReasons).toContain('OSM_PROVIDER_FAILED');
  });
});
