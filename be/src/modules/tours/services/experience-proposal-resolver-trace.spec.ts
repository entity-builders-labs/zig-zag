import { ExperienceProposalResolverService } from './experience-proposal-resolver.service';

describe('ExperienceProposalResolverService trace contract', () => {
  it('returns entity resolution, geographic validation and materialization as separate recorded phases', async () => {
    const boundary: any = {
      id: 'osm:relation:1',
      name: 'Buenos Aires',
      osmType: 'relation',
      osmId: 1,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-58.55, -34.7],
            [-58.3, -34.7],
            [-58.3, -34.45],
            [-58.55, -34.45],
            [-58.55, -34.7],
          ],
        ],
      },
      tags: {},
    };
    const osmPlaces: any = {
      lookupStreetsWithin: jest
        .fn()
        .mockResolvedValue({ status: 'success', value: [] }),
      lookupPoisWithin: jest.fn().mockResolvedValue({
        status: 'success',
        value: [
          {
            id: 'osm:node:10',
            name: 'Museo Real',
            osmType: 'node',
            osmId: 10,
            geometry: { type: 'Point', coordinates: [-58.4, -34.6] },
            tags: { tourism: 'museum' },
          },
        ],
      }),
    };
    const catalog: any = {
      upsertGeoEntity: jest.fn().mockResolvedValue({ id: 'geo-10' }),
      resolveOrCreateTraitDefinitions: jest.fn().mockResolvedValue([]),
      persistVerifiedExperience: jest.fn().mockResolvedValue({
        id: 'experience-10',
        dedupeDecision: 'NEW',
      }),
    };
    const validationResult = {
      proposalName: 'Visita Museo Real',
      kind: 'EXPERIENCE',
      status: 'GEO_VERIFIED',
      accepted: true,
      strategy: 'venue_centric',
      anchors: [],
      groundedEvidenceKeys: ['ev-1'],
      rejectionReasons: [],
      validatorVersion: 2,
    } as const;
    const geographicValidator: any = {
      validate: jest.fn().mockReturnValue(validationResult),
    };
    const service = new ExperienceProposalResolverService(
      osmPlaces,
      catalog,
      geographicValidator,
    );

    const response = await service.resolve({
      destinationName: 'Buenos Aires',
      geographicScope: { kind: 'AREA_BOUNDARY', boundary },
      candidates: [
        {
          name: 'Visita Museo Real',
          themes: ['culture'],
          traits: [],
          intents: ['visit'],
          componentHints: [
            {
              key: 'venue',
              name: 'Museo Real',
              role: 'venue',
              expectedKind: 'PLACE',
              required: true,
              evidenceKeys: ['ev-1'],
            },
          ],
          evidenceKeys: ['ev-1'],
          shortReason: 'Grounded museum visit',
        },
      ],
      evidence: [
        {
          key: 'ev-1',
          source: 'official',
          title: 'Museo Real Buenos Aires',
          snippet: 'Museo Real en Buenos Aires',
        },
      ],
    });

    expect(response.entityResolution).toBeDefined();
    expect(response.geographicValidation).toEqual(
      expect.objectContaining({
        acceptedCount: 1,
        rejectedCount: 0,
        results: [validationResult],
      }),
    );
    expect(response.materialization?.resolved[0]).toEqual(
      expect.objectContaining({
        status: 'accepted',
        experienceId: 'experience-10',
      }),
    );
  });
});
