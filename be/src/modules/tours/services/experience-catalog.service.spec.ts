import { ExperienceCatalogService } from './experience-catalog.service';

describe('ExperienceCatalogService dedupe', () => {
  const input: any = {
    canonicalName: ' Museo Central ',
    components: [{ geoEntityId: 'geo-1', role: 'venue', required: true }],
    evidence: [
      {
        source: 'search',
        url: 'https://example.test',
        title: 'Museo',
        snippet: 'evidence',
      },
    ],
  };

  it('reuses a structurally equivalent verified Experience and enriches it', async () => {
    const same: any = {
      id: 'exp-1',
      canonicalName: 'museo central',
      description: null,
      durationMinutes: null,
      price: null,
      qualityScore: null,
      latitude: null,
      longitude: null,
      metadata: {},
      components: [{ geoEntityId: 'geo-1', role: 'venue', required: true }],
      evidence: [],
      traits: [],
    };
    const updated = { ...same, evidence: input.evidence };
    const tx: any = {
      $executeRaw: jest.fn(),
      experience: {
        findMany: jest.fn().mockResolvedValue([same]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(updated),
      },
      experienceEvidence: { createMany: jest.fn() },
      experienceTrait: { createMany: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.persistVerifiedExperience(input);

    expect(result.id).toBe('exp-1');
    expect(result.dedupeDecision).toBe('SAME');
    expect(tx.experience.create).not.toHaveBeenCalled();
    expect(tx.experienceEvidence.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ experienceId: 'exp-1', source: 'search' }),
      ],
    });
    expect(tx.experience.update).toHaveBeenCalled();
  });

  it('serializes the identity check inside the transaction and creates NEW', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      experience: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'exp-new' }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    };

    const result = await new ExperienceCatalogService(
      prisma,
      {} as any,
    ).persistVerifiedExperience({ ...input, evidence: [] });

    expect(result.dedupeDecision).toBe('NEW');
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.experience.create).toHaveBeenCalled();
  });

  it('returns AMBIGUOUS for same-name Experiences with conflicting structure', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      experience: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'exp-old',
            canonicalName: 'museo central',
            latitude: null,
            longitude: null,
            components: [
              { geoEntityId: 'geo-other', role: 'venue', required: true },
            ],
            evidence: [],
            traits: [],
          },
        ]),
        create: jest.fn(),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    };

    const result = await new ExperienceCatalogService(
      prisma,
      {} as any,
    ).persistVerifiedExperience(input);

    expect(result.dedupeDecision).toBe('AMBIGUOUS');
    expect(tx.experience.create).not.toHaveBeenCalled();
  });

  it('does not merge false friends that share only one component', async () => {
    const falseFriend: any = {
      id: 'classic-route',
      canonicalName: 'Ruta del vino de Luján de Cuyo',
      latitude: -33.038,
      longitude: -68.879,
      components: [
        { geoEntityId: 'bodega-a', role: 'winery', required: true },
        { geoEntityId: 'bodega-b', role: 'winery', required: true },
        { geoEntityId: 'bodega-c', role: 'winery', required: true },
      ],
      evidence: [{ source: 'official-tourism' }],
      traits: [],
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      experience: {
        findMany: jest.fn().mockResolvedValue([falseFriend]),
        create: jest.fn(),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    };

    const result = await new ExperienceCatalogService(
      prisma,
      {} as any,
    ).persistVerifiedExperience({
      canonicalName: 'Ruta del vino premium de Luján de Cuyo',
      latitude: -33.038,
      longitude: -68.879,
      components: [
        { geoEntityId: 'bodega-a', role: 'winery', required: true },
        { geoEntityId: 'restaurant-x', role: 'lunch', required: true },
        { geoEntityId: 'bodega-z', role: 'winery', required: true },
      ],
      evidence: [{ source: 'official-tourism' }],
    });

    expect(result.dedupeDecision).toBe('AMBIGUOUS');
    expect(tx.experience.create).not.toHaveBeenCalled();
  });
});
