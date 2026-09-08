import { Prisma, GeoEntityKind } from '@prisma/client';
import { ExperienceCatalogService } from './experience-catalog.service';

describe('ExperienceCatalogService.upsertGeoEntity', () => {
  const input = {
    name: 'Jardín Botánico Chirau Mita',
    kind: GeoEntityKind.PLACE,
    provider: 'google',
    externalId: 'ChIJreal123',
    latitude: -29.16,
    longitude: -67.5,
  };

  it('updates the existing GeoEntity when an identity already exists', async () => {
    const prisma: any = {
      geoEntityIdentity: {
        findUnique: jest.fn().mockResolvedValue({ geoEntityId: 'geo-1' }),
      },
      geoEntity: {
        update: jest.fn().mockResolvedValue({ id: 'geo-1' }),
        create: jest.fn(),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.upsertGeoEntity(input);

    expect(result).toEqual({ id: 'geo-1' });
    expect(prisma.geoEntity.create).not.toHaveBeenCalled();
    expect(prisma.geoEntity.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'geo-1' } }),
    );
  });

  /**
   * Everything past the exact-identity check runs inside `$transaction`, so
   * every test below stubs it as `jest.fn((cb) => cb(prisma))` — the mock
   * plays the role of both the outer client and the `tx` handed to the
   * callback, which is enough since these tests never assert on real
   * cross-connection isolation.
   */
  function withTransaction(prisma: any) {
    prisma.$transaction = jest.fn((cb: any) => cb(prisma));
    prisma.$executeRaw = jest.fn().mockResolvedValue(undefined);
    return prisma;
  }

  it('creates a new GeoEntity when no identity exists yet and nothing nearby matches', async () => {
    const prisma: any = withTransaction({
      geoEntityIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      geoEntity: {
        create: jest.fn().mockResolvedValue({ id: 'geo-new' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.upsertGeoEntity(input);

    expect(result).toEqual({ id: 'geo-new' });
    expect(prisma.geoEntity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identities: {
            create: { provider: 'google', externalId: 'ChIJreal123' },
          },
        }),
      }),
    );
  });

  it('reconciles onto an existing nearby GeoEntity instead of creating a duplicate for the same real place', async () => {
    // Verified live: a composite Experience's Nominatim-resolved "Plaza
    // Dorrego" component and a separately-acquired standalone "Plaza
    // Dorrego" POI Experience ended up as two unrelated GeoEntity rows ~3m
    // apart — the tour then offered the same real plaza twice. A new
    // provider/externalId for a name+location that already exists nearby
    // must attach onto that entity, not mint a second one.
    const prisma: any = withTransaction({
      geoEntityIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      geoEntity: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'geo-existing-plaza' }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'geo-existing-plaza',
            name: 'Plaza Dorrego',
            latitude: input.latitude + 0.00002, // ~2m away
            longitude: input.longitude + 0.00002,
          },
        ]),
      },
    });
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.upsertGeoEntity({
      ...input,
      name: 'Plaza Dorrego',
    });

    expect(result).toEqual({ id: 'geo-existing-plaza' });
    expect(prisma.geoEntityIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          geoEntityId: 'geo-existing-plaza',
          provider: 'google',
          externalId: 'ChIJreal123',
        }),
      }),
    );
    expect(prisma.geoEntity.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'geo-existing-plaza' } }),
    );
    expect(prisma.geoEntity.create).not.toHaveBeenCalled();
  });

  it('does not reconcile onto a nearby GeoEntity whose name does not match', async () => {
    const prisma: any = withTransaction({
      geoEntityIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      geoEntity: {
        create: jest.fn().mockResolvedValue({ id: 'geo-new' }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'geo-unrelated-cafe',
            name: 'Café Británico',
            latitude: input.latitude + 0.00002,
            longitude: input.longitude + 0.00002,
          },
        ]),
      },
    });
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.upsertGeoEntity({
      ...input,
      name: 'Plaza Dorrego',
    });

    expect(result).toEqual({ id: 'geo-new' });
    expect(prisma.geoEntity.create).toHaveBeenCalled();
  });

  it('does not reconcile onto a same-named GeoEntity outside the reconciliation radius', async () => {
    const prisma: any = withTransaction({
      geoEntityIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      geoEntity: {
        create: jest.fn().mockResolvedValue({ id: 'geo-new' }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'geo-far-plaza-dorrego',
            name: 'Plaza Dorrego',
            latitude: input.latitude + 0.01, // ~1.1km away
            longitude: input.longitude,
          },
        ]),
      },
    });
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.upsertGeoEntity({
      ...input,
      name: 'Plaza Dorrego',
    });

    expect(result).toEqual({ id: 'geo-new' });
    expect(prisma.geoEntity.create).toHaveBeenCalled();
  });

  it('recovers from a concurrent-create race instead of crashing generation (real regression)', async () => {
    // Verified live: ExperienceProposalResolverService.resolve() resolves
    // every discovery candidate concurrently (Promise.all). Two candidates
    // referencing the same real place both saw "no identity yet" from
    // findUnique before either finished creating one — the second create()
    // call hit GeoEntityIdentity's real unique constraint and crashed the
    // whole tour generation with "No pudimos generar este tour." The
    // advisory lock now makes this practically unreachable, but the P2002
    // recovery stays as defense in depth.
    const conflictError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`provider`,`externalId`)',
      { code: 'P2002', clientVersion: 'test' },
    );
    const prisma: any = withTransaction({
      geoEntityIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ geoEntityId: 'geo-winner' }),
      },
      geoEntity: {
        create: jest.fn().mockRejectedValue(conflictError),
        update: jest.fn().mockResolvedValue({ id: 'geo-winner' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.upsertGeoEntity(input);

    expect(result).toEqual({ id: 'geo-winner' });
    expect(prisma.geoEntityIdentity.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalId: {
            provider: 'google',
            externalId: 'ChIJreal123',
          },
        },
      }),
    );
    expect(prisma.geoEntity.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'geo-winner' } }),
    );
  });

  it('re-throws an unrelated database error instead of masking it as a race', async () => {
    const otherError = new Error('connection lost');
    const prisma: any = withTransaction({
      geoEntityIdentity: { findUnique: jest.fn().mockResolvedValue(null) },
      geoEntity: {
        create: jest.fn().mockRejectedValue(otherError),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const service = new ExperienceCatalogService(prisma, {} as any);

    await expect(service.upsertGeoEntity(input)).rejects.toThrow(
      'connection lost',
    );
  });
});

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

  it('preserves dimensionedTraits alongside traits: string[] in findById', async () => {
    const prisma: any = {
      experience: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'e-winery',
          canonicalName: 'Bodega Catena',
          status: 'VERIFIED',
          durationMinutes: 120,
          metadata: {
            themes: ['wine'],
            traits: ['historic'],
            dimensionedTraits: [{ dimension: 'nature_type', key: 'mountain' }],
          },
          components: [],
          traits: [
            {
              traitDefinition: {
                dimension: 'winery_scale',
                key: 'boutique',
                label: 'Boutique Winery',
              },
            },
          ],
          media: [],
        }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);
    const result = await service.findById('e-winery');

    expect(result).not.toBeNull();
    expect(result?.traits).toEqual(
      expect.arrayContaining(['historic', 'Boutique Winery', 'boutique']),
    );
    expect(result?.dimensionedTraits).toEqual([
      { dimension: 'nature_type', key: 'mountain' },
      { dimension: 'winery_scale', key: 'boutique', label: 'Boutique Winery' },
    ]);
    expect(result?.metadata.dimensionedTraits).toEqual(
      result?.dimensionedTraits,
    );
  });

  it('preserves dimensionedTraits alongside traits: string[] in findVerifiedWithin', async () => {
    const prisma: any = {
      experience: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e-winery-1',
            canonicalName: 'Bodega Catena',
            status: 'VERIFIED',
            latitude: -34.6,
            longitude: -58.38,
            durationMinutes: 120,
            metadata: {
              themes: ['wine'],
              traits: ['historic'],
            },
            components: [],
            traits: [
              {
                traitDefinition: {
                  dimension: 'winery_scale',
                  key: 'boutique',
                  label: 'Boutique Winery',
                },
              },
            ],
          },
        ]),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);
    const results = await service.findVerifiedWithin(-34.6, -58.38, 5000, 10);

    expect(results).toHaveLength(1);
    expect(results[0].traits).toEqual(
      expect.arrayContaining(['historic', 'Boutique Winery', 'boutique']),
    );
    expect(results[0].dimensionedTraits).toEqual([
      { dimension: 'winery_scale', key: 'boutique', label: 'Boutique Winery' },
    ]);
    expect(results[0].metadata.dimensionedTraits).toEqual(
      results[0].dimensionedTraits,
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
