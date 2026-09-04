import { ExperienceCatalogService } from './experience-catalog.service';

describe('ExperienceCatalogService catalog retrieval', () => {
  it('does not pre-rank nearby candidates by quality before relevance ranking', async () => {
    const lowQualityRelevant: any = {
      id: 'relevant-low-quality',
      canonicalName: 'Relevant',
      description: 'Relevant experience',
      durationMinutes: 60,
      price: 10,
      qualityScore: 2,
      latitude: -34.6037,
      longitude: -58.3816,
      metadata: { themes: ['tango'], traits: [], intents: ['performance'] },
      components: [],
      traits: [],
    };
    const highQualityGeneric: any = {
      ...lowQualityRelevant,
      id: 'generic-high-quality',
      canonicalName: 'Generic',
      qualityScore: 5,
      latitude: -34.604,
      metadata: { themes: ['shopping'], traits: [], intents: ['visit'] },
    };
    const prisma: any = {
      experience: {
        findMany: jest
          .fn()
          .mockResolvedValue([highQualityGeneric, lowQualityRelevant]),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findVerifiedWithin(
      -34.6037,
      -58.3816,
      5000,
      10,
    );

    expect(prisma.experience.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { id: 'asc' },
        take: 1000,
      }),
    );
    expect(result.map((item) => item.id)).toEqual([
      'relevant-low-quality',
      'generic-high-quality',
    ]);
  });
});

describe('ExperienceCatalogService.findById', () => {
  it('returns null when no Experience matches the id', async () => {
    const prisma: any = {
      experience: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findById('missing-id');

    expect(result).toBeNull();
    expect(prisma.experience.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'missing-id' } }),
    );
  });

  it('returns null for an Experience that is not VERIFIED (e.g. still PENDING)', async () => {
    const prisma: any = {
      experience: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'e1',
          status: 'PENDING',
          components: [],
          traits: [],
          media: [],
        }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findById('e1');

    expect(result).toBeNull();
  });

  it('shapes a verified Experience with address from its first geolocatable component and real media as photos', async () => {
    const prisma: any = {
      experience: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'e1',
          canonicalName: 'Museo Central',
          description: 'A real museum',
          price: 15,
          qualityScore: 4.5,
          latitude: null,
          longitude: null,
          durationMinutes: 90,
          openingHours: { monday: '10:00-18:00' },
          mediaUpdatedAt: '2026-09-01T00:00:00.000Z',
          status: 'VERIFIED',
          metadata: { themes: ['history', 'art'], traits: ['guided'] },
          components: [
            {
              geoEntityId: 'geo-1',
              order: 1,
              geoEntity: {
                latitude: -34.6,
                longitude: -58.38,
                address: 'Av. de Mayo 123',
              },
            },
          ],
          traits: [
            { traitDefinition: { label: 'Family friendly', key: 'family' } },
          ],
          media: [
            { url: 'https://example.com/photo1.jpg', position: 0 },
            { url: 'https://example.com/photo2.jpg', position: 1 },
          ],
        }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findById('e1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'e1',
        canonicalName: 'Museo Central',
        name: 'Museo Central',
        description: 'A real museum',
        price: 15,
        qualityScore: 4.5,
        latitude: -34.6,
        longitude: -58.38,
        address: 'Av. de Mayo 123',
        durationMinutes: 90,
        duration: 1.5,
        openingHours: { monday: '10:00-18:00' },
        themes: ['history', 'art'],
        traits: expect.arrayContaining(['guided', 'Family friendly', 'family']),
        photos: [
          { url: 'https://example.com/photo1.jpg', position: 0 },
          { url: 'https://example.com/photo2.jpg', position: 1 },
        ],
        mediaUpdatedAt: '2026-09-01T00:00:00.000Z',
      }),
    );
  });
});

describe('ExperienceCatalogService.resolveOrCreateTraitDefinitions', () => {
  it('creates a TraitDefinition row per new trait, bucketed under the general dimension', async () => {
    const prisma: any = {
      traitDefinition: {
        upsert: jest
          .fn()
          .mockResolvedValueOnce({ id: 'trait-romantic' })
          .mockResolvedValueOnce({ id: 'trait-family-friendly' }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const ids = await service.resolveOrCreateTraitDefinitions([
      'romantic',
      'family-friendly',
    ]);

    expect(ids).toEqual(['trait-romantic', 'trait-family-friendly']);
    expect(prisma.traitDefinition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dimension_key: { dimension: 'general', key: 'romantic' } },
        create: { dimension: 'general', key: 'romantic', label: 'romantic' },
      }),
    );
  });

  it('reuses an existing TraitDefinition row for a case-insensitive match instead of duplicating it', async () => {
    const prisma: any = {
      traitDefinition: {
        upsert: jest.fn().mockResolvedValue({ id: 'trait-existing' }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const ids = await service.resolveOrCreateTraitDefinitions(['Romantic']);

    expect(ids).toEqual(['trait-existing']);
    expect(prisma.traitDefinition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dimension_key: { dimension: 'general', key: 'romantic' } },
      }),
    );
  });

  it('dedupes repeated trait strings within one call', async () => {
    const prisma: any = {
      traitDefinition: {
        upsert: jest.fn().mockResolvedValue({ id: 'trait-vegan' }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const ids = await service.resolveOrCreateTraitDefinitions([
      'vegan',
      'vegan',
      ' vegan ',
    ]);

    expect(ids).toEqual(['trait-vegan']);
    expect(prisma.traitDefinition.upsert).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array without calling Prisma when there are no traits', async () => {
    const prisma: any = { traitDefinition: { upsert: jest.fn() } };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const ids = await service.resolveOrCreateTraitDefinitions([]);

    expect(ids).toEqual([]);
    expect(prisma.traitDefinition.upsert).not.toHaveBeenCalled();
  });
});

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
