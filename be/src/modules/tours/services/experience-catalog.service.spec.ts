import { geographicScopeSearchWindow } from '../utils/experience-geographic-scope.policy';
import { Prisma, GeoEntityKind } from '@prisma/client';
import { ExperienceCatalogService } from './experience-catalog.service';
import { PlacesCrawlError } from '@integrations/google-places/interfaces/places-api.interface';
import { CURRENT_CLASSIFICATION_PROMPT_VERSION } from './experience-classification.service';
import { GeographicScope } from '../interfaces/experience-resolution.interface';

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

  it('deduplicates by persistence identity (dimension+lowercased key), not by raw string', async () => {
    const idByKey: Record<string, string> = {
      rooftop: 'trait-rooftop',
      'craft beer': 'trait-craft-beer',
    };
    const prisma: any = {
      traitDefinition: {
        upsert: jest.fn(({ where }: any) => {
          const key = where.dimension_key.key;
          return Promise.resolve({ id: idByKey[key] });
        }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const ids = await service.resolveOrCreateTraitDefinitions([
      'Rooftop',
      'rooftop',
      ' ROOFTOP ',
      'Craft Beer',
    ]);

    // Exactly one persistence identity per unique (general, lowercased-key).
    expect(prisma.traitDefinition.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.traitDefinition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dimension_key: { dimension: 'general', key: 'rooftop' } },
        create: { dimension: 'general', key: 'rooftop', label: 'Rooftop' },
      }),
    );
    expect(prisma.traitDefinition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dimension_key: { dimension: 'general', key: 'craft beer' } },
        create: {
          dimension: 'general',
          key: 'craft beer',
          label: 'Craft Beer',
        },
      }),
    );
    expect(ids).toEqual(['trait-rooftop', 'trait-craft-beer']);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('recovers the winning row when a concurrent create loses the P2002 race', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`dimension`,`key`)',
      { code: 'P2002', clientVersion: 'test' },
    );
    const prisma: any = {
      traitDefinition: {
        upsert: jest.fn().mockRejectedValue(p2002),
        findUnique: jest.fn().mockResolvedValue({ id: 'trait-winner' }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const ids = await service.resolveOrCreateTraitDefinitions(['craft_beer']);

    expect(ids).toEqual(['trait-winner']);
    expect(prisma.traitDefinition.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          dimension_key: { dimension: 'general', key: 'craft_beer' },
        },
      }),
    );
  });

  it('rethrows a P2002 whose winning row cannot be read (real inconsistency, not a race)', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const prisma: any = {
      traitDefinition: {
        upsert: jest.fn().mockRejectedValue(p2002),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    await expect(
      service.resolveOrCreateTraitDefinitions(['craft_beer']),
    ).rejects.toBe(p2002);
  });

  it('propagates a non-P2002 Prisma error without swallowing it', async () => {
    const other = new Prisma.PrismaClientKnownRequestError('boom', {
      code: 'P2010',
      clientVersion: 'test',
    });
    const prisma: any = {
      traitDefinition: {
        upsert: jest.fn().mockRejectedValue(other),
        findUnique: jest.fn(),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    await expect(
      service.resolveOrCreateTraitDefinitions(['craft_beer']),
    ).rejects.toBe(other);
    expect(prisma.traitDefinition.findUnique).not.toHaveBeenCalled();
  });

  it('stays concurrency-safe when parallel calls share a trait: one identity, one id (real P2002 observed against PostgreSQL)', async () => {
    // Faithful fake of the PostgreSQL race: the first create per compound key
    // wins; every later create for that key raises P2002 and must recover the
    // winner via findUnique.
    const winners: Record<string, string> = {};
    const seq: Record<string, number> = {};
    const prisma: any = {
      traitDefinition: {
        upsert: jest.fn(({ where, create }: any) => {
          const key = where.dimension_key.key;
          seq[key] = (seq[key] ?? 0) + 1;
          if (seq[key] === 1) {
            winners[key] = `id-${key}`;
            return Promise.resolve({ id: winners[key], ...create });
          }
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('unique', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          );
        }),
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve({ id: winners[where.dimension_key.key] ?? null }),
        ),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const results = await Promise.all([
      service.resolveOrCreateTraitDefinitions(['craft_beer', 'artisanal']),
      service.resolveOrCreateTraitDefinitions(['craft_beer', 'local']),
      service.resolveOrCreateTraitDefinitions(['CRAFT_BEER']),
      service.resolveOrCreateTraitDefinitions(['craft_beer']),
    ]);

    // Every reference to craft_beer resolves to the same single id.
    const craftBeerIds = new Set([
      results[0][0],
      results[1][0],
      results[2][0],
      results[3][0],
    ]);
    expect(craftBeerIds.size).toBe(1);
    // Exactly one persistence identity per key.
    expect(seq['craft_beer']).toBeGreaterThanOrEqual(1);
    expect(winners['craft_beer']).toBe('id-craft_beer');
    expect(winners['artisanal']).toBe('id-artisanal');
    expect(winners['local']).toBe('id-local');
    // 'CRAFT_BEER' lowercases to the same key -> no separate identity.
    expect(Object.keys(winners).sort()).toEqual([
      'artisanal',
      'craft_beer',
      'local',
    ]);
  });
});

describe('ExperienceCatalogService dedupe', () => {
  const input: any = {
    canonicalName: ' Museo Central ',
    components: [{ geoEntityId: 'geo-1', role: 'venue' }],
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
      components: [{ geoEntityId: 'geo-1', role: 'venue' }],
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

  it('merges the existing row and the new observation via mergeExperienceMetadata (Task B4) -- union themes/traits, strongest quality, never a naive last-write-wins overwrite', async () => {
    const same: any = {
      id: 'exp-1',
      canonicalName: 'museo central',
      description: null,
      durationMinutes: null,
      price: null,
      qualityScore: 2.5,
      latitude: null,
      longitude: null,
      metadata: { themes: ['history'], traits: ['rooftop'] },
      components: [{ geoEntityId: 'geo-1', role: 'venue' }],
      evidence: [],
      traits: [],
    };
    const enrichedInput = {
      ...input,
      qualityScore: 4.1,
      metadata: { themes: ['food'], traits: ['craft beer'] },
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      experience: {
        findMany: jest.fn().mockResolvedValue([same]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...same, evidence: [] }),
      },
      experienceEvidence: { createMany: jest.fn() },
      experienceTrait: { createMany: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    await service.persistVerifiedExperience(enrichedInput);

    expect(tx.experience.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          qualityScore: 4.1,
          metadata: expect.objectContaining({
            themes: ['food', 'history'],
            traits: ['craft beer', 'rooftop'],
          }),
        }),
      }),
    );
  });

  it('persists an explicitly EMPTY canonical metadata object ({}) rather than silently leaving stale metadata untouched (review fix B4.1)', async () => {
    // A stale (superseded prompt version) classification -- the merge
    // correctly decides this is worthless and the canonical result is {}.
    const staleClassification = {
      themes: ['history'],
      intents: [] as string[],
      traits: [] as string[],
      reasoningEvidence: [
        { facet: 'theme:history', evidenceKeys: ['ev-1'], reason: 'x' },
      ],
      modelId: 'stale-model',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION - 1,
      state: 'classified',
    };
    const same: any = {
      id: 'exp-1',
      canonicalName: 'museo central',
      description: null,
      durationMinutes: null,
      price: null,
      qualityScore: null,
      latitude: null,
      longitude: null,
      metadata: { classification: staleClassification },
      components: [{ geoEntityId: 'geo-1', role: 'venue' }],
      evidence: [],
      traits: [],
    };
    const emptyInput = { ...input, metadata: {} };
    const tx: any = {
      $executeRaw: jest.fn(),
      experience: {
        findMany: jest.fn().mockResolvedValue([same]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...same, evidence: [] }),
      },
      experienceEvidence: { createMany: jest.fn() },
      experienceTrait: { createMany: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    await service.persistVerifiedExperience(emptyInput);

    // The canonical merge correctly drops the stale classification --
    // Prisma must be told to actually WRITE {}, not `undefined` (which
    // would mean "leave the column untouched" and silently keep the
    // stale classification in the database).
    expect(tx.experience.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: {} }),
      }),
    );
    const call = tx.experience.update.mock.calls[0][0];
    expect(call.data.metadata).not.toBeUndefined();
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

  it('deduplicates repeated traitDefinitionIds before the NEW-experience nested create (composite PK safety)', async () => {
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

    await new ExperienceCatalogService(
      prisma,
      {} as any,
    ).persistVerifiedExperience({
      ...input,
      evidence: [],
      traitDefinitionIds: ['trait-a', 'trait-a', 'trait-b', 'trait-a'],
    });

    const created = tx.experience.create.mock.calls[0][0].data.traits.create;
    expect(created).toEqual([
      { traitDefinitionId: 'trait-a' },
      { traitDefinitionId: 'trait-b' },
    ]);
  });

  it('deduplicates repeated traitDefinitionIds on the SAME/existing path too', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      experience: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'exp-same',
            canonicalName: 'museo central',
            description: null,
            durationMinutes: null,
            price: null,
            qualityScore: null,
            latitude: null,
            longitude: null,
            metadata: {},
            components: [{ geoEntityId: 'geo-1', role: 'venue' }],
            evidence: [],
            traits: [],
          },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'exp-same', components: [] }),
        create: jest.fn(),
      },
      experienceEvidence: { createMany: jest.fn() },
      experienceTrait: { createMany: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    };

    await new ExperienceCatalogService(
      prisma,
      {} as any,
    ).persistVerifiedExperience({
      ...input,
      evidence: [],
      traitDefinitionIds: ['trait-a', 'trait-a', 'trait-b'],
    });

    expect(tx.experienceTrait.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { experienceId: 'exp-same', traitDefinitionId: 'trait-a' },
          { experienceId: 'exp-same', traitDefinitionId: 'trait-b' },
        ],
        skipDuplicates: true,
      }),
    );
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
            components: [{ geoEntityId: 'geo-other', role: 'venue' }],
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
        { geoEntityId: 'bodega-a', role: 'winery' },
        { geoEntityId: 'bodega-b', role: 'winery' },
        { geoEntityId: 'bodega-c', role: 'winery' },
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
        { geoEntityId: 'bodega-a', role: 'winery' },
        { geoEntityId: 'restaurant-x', role: 'lunch' },
        { geoEntityId: 'bodega-z', role: 'winery' },
      ],
      evidence: [{ source: 'official-tourism' }],
    });

    expect(result.dedupeDecision).toBe('AMBIGUOUS');
    expect(tx.experience.create).not.toHaveBeenCalled();
  });
});

describe('ExperienceCatalogService.acquireNearbyAsExperiences (Phase 4 shortcut elimination)', () => {
  it('must not call upsertGeoEntity or persistVerifiedExperience directly from Google Places observations', async () => {
    const placesApi: any = {
      searchNearby: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'ChIJTest123',
            displayName: { text: 'Test Museum' },
            formattedAddress: 'Calle Falsa 123',
            location: { latitude: -34.6, longitude: -58.38 },
            primaryType: 'museum',
            types: ['museum', 'tourist_attraction'],
            rating: 4.5,
          },
        ],
        provenance: {
          provider: 'google',
          cacheStatus: 'miss-live',
          requestedCount: 1,
          receivedCount: 1,
        },
      }),
    };

    const prisma: any = {
      geoEntity: { create: jest.fn(), update: jest.fn() },
      experience: { create: jest.fn() },
    };

    const service = new ExperienceCatalogService(prisma, placesApi);
    const upsertSpy = jest.spyOn(service, 'upsertGeoEntity');
    const persistSpy = jest.spyOn(service, 'persistVerifiedExperience');

    const result = await service.acquireNearbyAsExperiences({
      latitude: -34.6,
      longitude: -58.38,
      radius: 5000,
      maxResultCount: 10,
    });

    // Invariant: acquireNearbyAsExperiences is strictly non-persistent.
    // It must NEVER write GeoEntities or Experiences directly.
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
    expect(result.experienceIds).toEqual([]);
    expect(result.experiences).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe('Test Museum');
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].externalId).toBe('ChIJTest123');
  });

  it('surfaces a Google Places provider failure as a PlacesCrawlError, not a successful empty acquisition', async () => {
    const failingProvider: any = {
      acquire: jest.fn().mockResolvedValue({
        status: 'failed',
        value: [],
        failureReason: 'Places API quota exceeded (OVER_QUERY_LIMIT)',
      }),
    };
    const synthesizer: any = { synthesizeProposals: jest.fn() };
    const corroborator: any = { corroborateAndMerge: jest.fn() };
    const service = new ExperienceCatalogService(
      {} as any,
      {} as any,
      failingProvider,
      synthesizer,
      corroborator,
    );

    const call = service.acquireNearbyAsExperiences({
      latitude: -34.6,
      longitude: -58.38,
      radius: 5000,
      maxResultCount: 10,
    });

    await expect(call).rejects.toBeInstanceOf(PlacesCrawlError);
    await call.catch((error: PlacesCrawlError) => {
      expect(error.provenance.receivedCount).toBe(0);
      expect(error.provenance.acceptedCount).toBe(0);
      expect(error.code).toBe('request_failed');
    });
    // A failure must never be laundered into candidate synthesis.
    expect(synthesizer.synthesizeProposals).not.toHaveBeenCalled();
    expect(corroborator.corroborateAndMerge).not.toHaveBeenCalled();
  });

  it('treats a successful empty provider result as a normal empty acquisition (no error)', async () => {
    const emptyProvider: any = {
      acquire: jest.fn().mockResolvedValue({ status: 'success', value: [] }),
    };
    const service = new ExperienceCatalogService(
      {} as any,
      {} as any,
      emptyProvider,
      { synthesizeProposals: jest.fn() } as any,
      { corroborateAndMerge: jest.fn() } as any,
    );

    const result = await service.acquireNearbyAsExperiences({
      latitude: -34.6,
      longitude: -58.38,
      radius: 5000,
      maxResultCount: 10,
    });

    expect(result.experienceIds).toEqual([]);
    expect(result.experiences).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result.provenance.receivedCount).toBe(0);
  });
});

describe('ExperienceCatalogService.findVerifiedByIds', () => {
  it('returns exactly the requested verified rows, in order, and nothing else', async () => {
    const row = (id: string): any => ({
      id,
      canonicalName: id,
      description: `${id} description`,
      price: null,
      qualityScore: null,
      latitude: -34.6,
      longitude: -58.38,
      durationMinutes: 60,
      openingHours: null,
      metadata: { themes: ['history'] },
      components: [],
      traits: [],
    });
    const prisma: any = {
      experience: {
        findMany: jest.fn().mockResolvedValue([row('exp-new')]),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findVerifiedByIds(['exp-new']);

    expect(prisma.experience.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['exp-new'] }, status: 'VERIFIED' },
      }),
    );
    expect(result.map((item) => item.id)).toEqual(['exp-new']);
  });

  it('short-circuits without touching Prisma for an empty id list', async () => {
    const prisma: any = { experience: { findMany: jest.fn() } };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findVerifiedByIds([]);

    expect(result).toEqual([]);
    expect(prisma.experience.findMany).not.toHaveBeenCalled();
  });
});

describe('ExperienceCatalogService.findClassificationContextById', () => {
  it('T1: maps persisted ExperienceEvidence rows to ExperienceGroundingEvidence with persisted row ID as key', async () => {
    const prisma: any = {
      experience: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'exp-1',
          canonicalName: 'Caminito Walking Tour',
          metadata: {},
          evidence: [
            {
              id: 'ev-persisted-1',
              source: 'serper',
              url: 'https://example.com',
              title: 'Caminito',
              snippet: 'Caminito is a colorful street museum in La Boca',
            },
            {
              id: 'ev-persisted-2',
              source: 'serper',
              snippet: '',
            },
          ],
        }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findClassificationContextById('exp-1');

    expect(result).not.toBeNull();
    expect(result!.experienceId).toBe('exp-1');
    expect(result!.canonicalName).toBe('Caminito Walking Tour');
    expect(result!.evidence).toEqual([
      {
        key: 'ev-persisted-1',
        source: 'serper',
        snippet: 'Caminito is a colorful street museum in La Boca',
        title: 'Caminito',
        url: 'https://example.com',
      },
    ]);
  });

  it('returns null when experience is not found', async () => {
    const prisma: any = {
      experience: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findClassificationContextById('exp-missing');

    expect(result).toBeNull();
  });
});

describe('ExperienceCatalogService.findVerifiedMultiComponentByExactComponent (Task B5)', () => {
  it('finds a multi-component verified Experience with the exact required ROUTE component', async () => {
    const prisma: any = {
      experience: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            // // Fixture shape only (row shape of the membership query); outcome unchanged.
            {
              id: 'exp-caminito',
              components: [
                { geoEntityId: 'geo-caminito', resolutionState: 'RESOLVED' },
                { geoEntityId: 'geo-b', resolutionState: 'RESOLVED' },
                { geoEntityId: 'geo-c', resolutionState: 'RESOLVED' },
              ],
            },
          ])
          .mockResolvedValueOnce([
            {
              id: 'exp-caminito',
              canonicalName: 'Caminito Walk',
              description: null,
              price: null,
              qualityScore: null,
              latitude: null,
              longitude: null,
              durationMinutes: null,
              openingHours: null,
              metadata: {},
              components: [],
              traits: [],
            },
          ]),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result =
      await service.findVerifiedMultiComponentByExactComponent('geo-caminito');

    expect(prisma.experience.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: 'VERIFIED',
          components: { some: { geoEntityId: 'geo-caminito' } },
        },
      }),
    );
    expect(result.map((row) => row.id)).toEqual(['exp-caminito']);
  });

  it('excludes a single-component Experience (the exact component alone does not satisfy "multi-component")', async () => {
    const prisma: any = {
      experience: {
        findMany: jest
          .fn()
          // // Fixture shape only (row shape of the membership query); outcome unchanged.
          .mockResolvedValue([
            {
              id: 'exp-single',
              components: [
                { geoEntityId: 'geo-x', resolutionState: 'RESOLVED' },
              ],
            },
          ]),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result =
      await service.findVerifiedMultiComponentByExactComponent('geo-x');

    expect(result).toEqual([]);
  });

  it('returns [] without touching Prisma for an empty geoEntityId', async () => {
    const prisma: any = { experience: { findMany: jest.fn() } };
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findVerifiedMultiComponentByExactComponent('');

    expect(result).toEqual([]);
    expect(prisma.experience.findMany).not.toHaveBeenCalled();
  });
});

describe('ExperienceCatalogService.findVerifiedTourismRouteByName (Task B5, Cleanup 2)', () => {
  it('finds a multi-component Experience whose canonicalName normalizes identically to the anchor name', async () => {
    const prisma: any = {};
    const service = new ExperienceCatalogService(prisma, {} as any);
    jest.spyOn(service, 'findVerifiedWithinForMatching').mockResolvedValue([
      {
        id: 'exp-ruta',
        canonicalName: 'Ruta del Vino de Mendoza',
        components: [
          { geoEntityId: 'geo-1', geoEntity: {} },
          { geoEntityId: 'geo-2', geoEntity: {} },
        ],
      } as any,
    ]);

    const result = await service.findVerifiedTourismRouteByName(
      'ruta del vino de mendoza',
      -32.89,
      -68.84,
      50_000,
    );

    expect(result.map((row) => row.id)).toEqual(['exp-ruta']);
  });

  it('does NOT match a genuinely different name for the same real route (strict identity, no fuzzy/alias matching)', async () => {
    const prisma: any = {};
    const service = new ExperienceCatalogService(prisma, {} as any);
    jest.spyOn(service, 'findVerifiedWithinForMatching').mockResolvedValue([
      {
        id: 'exp-mendoza-wine-route',
        canonicalName: 'Mendoza Wine Route',
        components: [
          { geoEntityId: 'geo-1', geoEntity: {} },
          { geoEntityId: 'geo-2', geoEntity: {} },
        ],
      } as any,
    ]);

    const result = await service.findVerifiedTourismRouteByName(
      'ruta del vino de mendoza',
      -32.89,
      -68.84,
      50_000,
    );

    expect(result).toEqual([]);
  });

  it('excludes a single-component match (not a real multi-component route)', async () => {
    const prisma: any = {};
    const service = new ExperienceCatalogService(prisma, {} as any);
    jest.spyOn(service, 'findVerifiedWithinForMatching').mockResolvedValue([
      {
        id: 'exp-single',
        canonicalName: 'Ruta del Vino de Mendoza',
        components: [{ geoEntityId: 'geo-1', geoEntity: {} }],
      } as any,
    ]);

    const result = await service.findVerifiedTourismRouteByName(
      'ruta del vino de mendoza',
      -32.89,
      -68.84,
      50_000,
    );

    expect(result).toEqual([]);
  });

  it('returns [] without querying for an empty normalized name', async () => {
    const prisma: any = {};
    const service = new ExperienceCatalogService(prisma, {} as any);
    const spy = jest
      .spyOn(service, 'findVerifiedWithinForMatching')
      .mockResolvedValue([]);

    const result = await service.findVerifiedTourismRouteByName(
      '',
      -32.89,
      -68.84,
      50_000,
    );

    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('ExperienceCatalogService.applyEvidenceClassification (Task B5)', () => {
  it('persists the classifier verdict as authoritative, not unioned with stale discovery-era metadata', async () => {
    const prisma: any = {
      experience: {
        findUnique: jest.fn().mockResolvedValue({
          metadata: {
            intents: ['walk'],
            themes: ['culture'],
            source: 'grounded_experience_discovery',
          },
          qualityScore: 3.5,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      experienceTrait: { createMany: jest.fn().mockResolvedValue({}) },
      traitDefinition: {
        upsert: jest.fn().mockResolvedValue({ id: 'trait-1' }),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    await service.applyEvidenceClassification('exp-1', {
      themes: [],
      intents: ['food'],
      traits: [],
      reasoningEvidence: [
        {
          facet: 'intent:food',
          evidenceKeys: ['ev-1'],
          reason: 'evidence supports food',
        },
      ],
      modelId: 'groq/qwen',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'classified',
    });

    expect(prisma.experience.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exp-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            themes: [],
            intents: ['food'],
            source: 'grounded_experience_discovery',
            classification: expect.objectContaining({
              state: 'classified',
              promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
            }),
          }),
        }),
      }),
    );
    // The stale 'walk' intent must never survive as authoritative -- the
    // update's metadata.intents is exactly the classifier's own verdict.
    const call = prisma.experience.update.mock.calls[0][0];
    expect(call.data.metadata.intents).toEqual(['food']);
  });

  it('persists an honest degraded classification without crashing', async () => {
    const prisma: any = {
      experience: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ metadata: {}, qualityScore: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      experienceTrait: { createMany: jest.fn() },
      traitDefinition: { upsert: jest.fn() },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    await service.applyEvidenceClassification('exp-2', {
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
      modelId: 'groq/qwen',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'degraded',
    });

    expect(prisma.experience.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            classification: expect.objectContaining({ state: 'degraded' }),
          }),
        }),
      }),
    );
  });

  it('is a no-op when the Experience no longer exists', async () => {
    const prisma: any = {
      experience: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const service = new ExperienceCatalogService(prisma, {} as any);

    await service.applyEvidenceClassification('missing', {
      themes: [],
      intents: [],
      traits: [],
      reasoningEvidence: [],
      modelId: 'groq/qwen',
      promptVersion: CURRENT_CLASSIFICATION_PROMPT_VERSION,
      state: 'classified',
    });

    expect(prisma.experience.update).not.toHaveBeenCalled();
  });
});

/**
 * Stage 3 checkpoint (component-resolution-and-partial-composite-recovery-
 * plan.md, "Catalog-first identity resolution"). Supersedes the Stage 1
 * lock this file used to carry (Case I, which only froze that
 * `findGeoEntityCandidatesForHint` did not exist yet) — the exact same
 * relationship Stage 2's own "source-composition-authority correction"
 * addendum used when it replaced a Stage-1 locking test with real
 * corrected behavior.
 *
 * Ownership under test here: this method is a bounded, provider-neutral
 * READ only. It returns candidates/facts and never chooses a winner or
 * declares identity truth — that split is enforced at the resolver seam
 * (`ExperienceProposalResolverService.resolveViaCatalog` +
 * `IdentityVerifier`), not here.
 */
describe('ExperienceCatalogService.findGeoEntityCandidatesForHint (Stage 3)', () => {
  const pointScope: GeographicScope = {
    kind: 'POINT_RADIUS',
    latitude: -34.62,
    longitude: -58.37,
    radiusMeters: 500,
  };

  function prismaWithRows(rows: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    // No verified hint memory in these canonical-name cases.
    const $queryRaw = jest.fn().mockResolvedValue([]);
    return {
      prisma: { geoEntity: { findMany }, $queryRaw } as any,
      findMany,
      $queryRaw,
    };
  }

  it('issues one bounded, kind-filtered, index-backed query for a POINT_RADIUS scope — never an unbounded table scan', async () => {
    const { prisma, findMany } = prismaWithRows([]);
    const service = new ExperienceCatalogService(prisma, {} as any);

    await service.findGeoEntityCandidatesForHint({
      hintName: 'Solar French',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(pointScope, 'DESTINATION_AREA')!,
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    const call = findMany.mock.calls[0][0];
    // Bounded: a lat/lon range (reusing the existing [latitude, longitude]
    // index), never an unfiltered `findMany({})`.
    expect(call.where.kind).toBe(GeoEntityKind.PLACE);
    expect(call.where.latitude.gte).toBeLessThan(pointScope.latitude);
    expect(call.where.latitude.lte).toBeGreaterThan(pointScope.latitude);
    expect(call.where.longitude.gte).toBeLessThan(pointScope.longitude);
    expect(call.where.longitude.lte).toBeGreaterThan(pointScope.longitude);
    // Persisted GeoEntityIdentity records are read alongside the row,
    // deterministically ordered (oldest first) — the "existing schema,
    // no alias table" contract, with a deterministic choice available to
    // the caller.
    expect(call.include.identities.orderBy).toEqual({ createdAt: 'asc' });
  });

  it("derives a bounded box from an AREA_BOUNDARY scope's own resolved boundary geometry, not a second geographic authority", async () => {
    const { prisma, findMany } = prismaWithRows([]);
    const service = new ExperienceCatalogService(prisma, {} as any);
    const areaScope: GeographicScope = {
      kind: 'AREA_BOUNDARY',
      boundary: {
        id: 'osm:relation:1',
        name: 'San Telmo',
        osmType: 'relation',
        osmId: 1,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-58.38, -34.63],
              [-58.36, -34.63],
              [-58.36, -34.61],
              [-58.38, -34.61],
              [-58.38, -34.63],
            ],
          ],
        },
        tags: {},
      } as any,
    };

    await service.findGeoEntityCandidatesForHint({
      hintName: 'Mercado de San Telmo',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(areaScope, 'DESTINATION_AREA')!,
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    const call = findMany.mock.calls[0][0];
    // The boundary spans roughly -58.38..-58.36 / -34.63..-34.61 — the
    // derived box must cover it (center-radius reuses the existing
    // boundingBoxToCenterRadius helper, never a second envelope algorithm).
    expect(call.where.latitude.gte).toBeLessThanOrEqual(-34.63);
    expect(call.where.latitude.lte).toBeGreaterThanOrEqual(-34.61);
    expect(call.where.longitude.gte).toBeLessThanOrEqual(-58.38);
    expect(call.where.longitude.lte).toBeGreaterThanOrEqual(-58.36);
  });

  it('fails closed — no query at all — when the search window has no usable center/radius', async () => {
    const { prisma, findMany } = prismaWithRows([]);
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'Anything',
      expectedKind: GeoEntityKind.PLACE,
      window: {
        provenance: 'DESTINATION_AREA',
        center: { latitude: Number.NaN, longitude: Number.NaN },
        radiusMeters: Number.NaN,
      },
    });

    expect(result.candidates).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns zero candidates (catalog miss) when nothing in the bounded pool matches the hint name', async () => {
    const { prisma } = prismaWithRows([
      {
        id: 'geo-1',
        name: 'Completely Different Place',
        kind: GeoEntityKind.PLACE,
        latitude: -34.62,
        longitude: -58.37,
        geometry: null,
        address: null,
        identities: [],
      },
    ]);
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'Solar French',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(pointScope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates).toEqual([]);
  });

  it('returns exactly one candidate for a unique strict normalized-name match, carrying its persisted GeoEntityIdentity as provenance', async () => {
    const { prisma } = prismaWithRows([
      {
        id: 'geo-solar-french',
        name: 'Solar French',
        kind: GeoEntityKind.PLACE,
        latitude: -34.62,
        longitude: -58.37,
        geometry: { type: 'Point', coordinates: [-58.37, -34.62] },
        address: null,
        identities: [
          { provider: 'openstreetmap', externalId: 'osm:node:6903962986' },
        ],
      },
    ]);
    const service = new ExperienceCatalogService(prisma, {} as any);

    // Diacritics/case/whitespace normalization only -- strict equality, no
    // substring/fuzzy match: "SOLAR   french" still matches "Solar French".
    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'SOLAR   french',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(pointScope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        geoEntityId: 'geo-solar-french',
        name: 'Solar French',
        kind: GeoEntityKind.PLACE,
        identities: [
          { provider: 'openstreetmap', externalId: 'osm:node:6903962986' },
        ],
      }),
    ]);
  });

  it('does not narrow a substring/partial name match to a candidate (strict equality only)', async () => {
    const { prisma } = prismaWithRows([
      {
        id: 'geo-annex',
        name: 'Solar French Annex',
        kind: GeoEntityKind.PLACE,
        latitude: -34.62,
        longitude: -58.37,
        geometry: null,
        address: null,
        identities: [{ provider: 'openstreetmap', externalId: 'osm:node:1' }],
      },
    ]);
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'Solar French',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(pointScope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates).toEqual([]);
  });

  it('returns ALL strictly-matching candidates when the bounded pool is genuinely ambiguous — never picks a winner itself', async () => {
    const { prisma } = prismaWithRows([
      {
        id: 'geo-node',
        name: 'Solar de French',
        kind: GeoEntityKind.PLACE,
        latitude: -34.62,
        longitude: -58.37,
        geometry: null,
        address: null,
        identities: [
          { provider: 'openstreetmap', externalId: 'osm:node:6903962986' },
        ],
      },
      {
        id: 'geo-relation',
        name: 'Solar de French',
        kind: GeoEntityKind.PLACE,
        latitude: -34.6201,
        longitude: -58.3701,
        geometry: null,
        address: null,
        identities: [
          { provider: 'openstreetmap', externalId: 'osm:relation:9314953' },
        ],
      },
    ]);
    const service = new ExperienceCatalogService(prisma, {} as any);

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'Solar de French',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(pointScope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.geoEntityId).sort()).toEqual([
      'geo-node',
      'geo-relation',
    ]);
  });

  it('filters by the requested GeoEntityKind at query time — a same-name row of a different kind is never eligible', async () => {
    const { prisma, findMany } = prismaWithRows([]);
    const service = new ExperienceCatalogService(prisma, {} as any);

    await service.findGeoEntityCandidatesForHint({
      hintName: 'San Telmo',
      expectedKind: GeoEntityKind.AREA,
      window: geographicScopeSearchWindow(pointScope, 'DESTINATION_AREA')!,
    });

    expect(findMany.mock.calls[0][0].where.kind).toBe(GeoEntityKind.AREA);
  });

  it('is fail-closed for a GeoEntity with no persisted GeoEntityIdentity at all (no deterministic provenance to build from)', async () => {
    const { prisma } = prismaWithRows([
      {
        id: 'geo-orphan',
        name: 'Solar French',
        kind: GeoEntityKind.PLACE,
        latitude: -34.62,
        longitude: -58.37,
        geometry: null,
        address: null,
        identities: [],
      },
    ]);
    const service = new ExperienceCatalogService(prisma, {} as any);

    // The catalog itself still reports this row as a bounded, name-matching
    // candidate (identity provenance is the RESOLVER's fail-closed concern
    // via resolveViaCatalog, not a fact this read-only method should hide).
    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'Solar French',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(pointScope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ geoEntityId: 'geo-orphan', identities: [] }),
    ]);
  });
});

/**
 * Stage 3 checkpoint — Solar de French warm-reuse characterization.
 * Reuses the Stage 1 characterization baseline (this file's former Case I,
 * `experience-catalog.service.spec.ts`): three independent cold runs each
 * re-derived and re-persisted a fresh canonical identity for the exact same
 * real OSM object (`osm:node:6903962986`) because no catalog-first read
 * existed. This proves the read side of the fix: a later compatible hint,
 * once a canonical GeoEntity for this place already exists, reuses that
 * same `geoEntityId` via `findGeoEntityCandidatesForHint` instead of a
 * blank-slate re-resolution — while the SEPARATE, genuinely divergent
 * node-vs-relation warm-run cluster (also observed in the Stage 1 corpus)
 * stays explicit as ambiguous, not silently collapsed.
 */
describe('ExperienceCatalogService — Solar de French warm-reuse (Stage 3)', () => {
  const warmScope: GeographicScope = {
    kind: 'POINT_RADIUS',
    latitude: -34.62,
    longitude: -58.37,
    radiusMeters: 500,
  };

  it('reuses the same canonical GeoEntity id a prior cold run already persisted for this real place', async () => {
    // Simulates the state left behind by an earlier (cold-1) run: Solar
    // French was verified via LOCAL_OSM_POOL and persisted once.
    const previousGeoEntityId = 'geo-solar-french-cold-1';
    const findMany = jest.fn().mockResolvedValue([
      {
        id: previousGeoEntityId,
        name: 'Solar French',
        kind: GeoEntityKind.PLACE,
        latitude: -34.62,
        longitude: -58.37,
        geometry: { type: 'Point', coordinates: [-58.37, -34.62] },
        address: null,
        identities: [
          { provider: 'openstreetmap', externalId: 'osm:node:6903962986' },
        ],
      },
    ]);
    const service = new ExperienceCatalogService(
      {
        geoEntity: { findMany },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as any,
      {} as any,
    );

    // A later request's real componentHint for the same place.
    const warmResult = await service.findGeoEntityCandidatesForHint({
      hintName: 'Solar French',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(warmScope, 'DESTINATION_AREA')!,
    });

    expect(warmResult.candidates).toHaveLength(1);
    expect(warmResult.candidates[0].geoEntityId).toBe(previousGeoEntityId);
    expect(warmResult.candidates[0].identities).toEqual([
      { provider: 'openstreetmap', externalId: 'osm:node:6903962986' },
    ]);
    // No new external identity acquisition is implied by this read — the
    // resolver seam (experience-proposal-resolver.service.spec.ts's own
    // Stage 3 no-network describe block) proves the OSM/Nominatim/Places/
    // Wikidata call count directly; this test proves the catalog fact this
    // reuse decision is built from.
  });

  it('keeps a genuinely competing node-vs-relation cluster explicit instead of collapsing it to the older row', async () => {
    // The SEPARATE warm-run divergence the Stage 1 corpus also observed:
    // a differently-keyed hint's bounded pool contains two structurally
    // different real OSM objects sharing the same name.
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'geo-solar-french-node',
        name: 'Solar de French',
        kind: GeoEntityKind.PLACE,
        latitude: -34.62,
        longitude: -58.37,
        geometry: null,
        address: null,
        identities: [
          { provider: 'openstreetmap', externalId: 'osm:node:6903962986' },
        ],
      },
      {
        id: 'geo-solar-french-relation',
        name: 'Solar de French',
        kind: GeoEntityKind.PLACE,
        latitude: -34.6202,
        longitude: -58.3702,
        geometry: null,
        address: null,
        identities: [
          { provider: 'openstreetmap', externalId: 'osm:relation:9314953' },
        ],
      },
    ]);
    const service = new ExperienceCatalogService(
      {
        geoEntity: { findMany },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as any,
      {} as any,
    );

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'Solar de French',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(warmScope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates).toHaveLength(2);
  });
});

/**
 * Verified hint memory (Stage 3): `verifiedHintNameKeys` holds the
 * `normalizeGeoName` keys of hint texts that previously resolved VERIFIED
 * to a GeoEntity. The catalog read unions canonical-name and verified-hint
 * matches by id (multiplicity kept); the write is one atomic, idempotent
 * UPDATE. Real-Postgres behavior (GIN usage, concurrency, CHECK) lives in
 * test/integration/tour-generation/verified-hint-memory.integration-spec.ts.
 */
describe('ExperienceCatalogService — verified hint memory', () => {
  const scope: GeographicScope = {
    kind: 'POINT_RADIUS',
    latitude: -34.61,
    longitude: -58.372,
    radiusMeters: 5_000,
  };
  const row = (id: string, name: string) => ({
    id,
    name,
    kind: GeoEntityKind.PLACE,
    latitude: -34.6102605,
    longitude: -58.3721513,
    geometry: null as unknown,
    address: null as string | null,
    identities: [{ provider: 'openstreetmap', externalId: `osm:node:${id}` }],
  });
  const sqlOf = (mock: jest.Mock) =>
    (mock.mock.calls[0][0] as TemplateStringsArray).join('?');

  function build(options: {
    bboxRows: unknown[];
    verifiedHintIds: string[];
    verifiedHintRows?: unknown[];
  }) {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(options.bboxRows)
      .mockResolvedValueOnce(options.verifiedHintRows ?? []);
    const $queryRaw = jest
      .fn()
      .mockResolvedValue(options.verifiedHintIds.map((id) => ({ id })));
    const service = new ExperienceCatalogService(
      { geoEntity: { findMany }, $queryRaw } as any,
      {} as any,
    );
    return { service, findMany, $queryRaw };
  }

  it('finds a GeoEntity whose canonical name differs from the hint through its remembered key (matchKind VERIFIED_HINT)', async () => {
    const farmacia = row('geo-farmacia', 'Farmacia de la Estrella');
    const { service, findMany, $queryRaw } = build({
      bboxRows: [farmacia],
      verifiedHintIds: ['geo-farmacia'],
      verifiedHintRows: [farmacia],
    });

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'Farmacia la Estrella',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(scope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        geoEntityId: 'geo-farmacia',
        name: 'Farmacia de la Estrella',
        matchKind: 'VERIFIED_HINT',
      }),
    ]);
    // The verified-hint read is its own GIN-servable `@>` query, bounded
    // by the same kind + bbox, keyed by the canonical normalization.
    const sql = sqlOf($queryRaw);
    expect(sql).toContain('"verifiedHintNameKeys" @> ARRAY[?]::text[]');
    expect(sql).toContain('"kind" = ?::"GeoEntityKind"');
    expect(sql).toContain('"latitude" BETWEEN ? AND ?');
    expect(sql).toContain('"longitude" BETWEEN ? AND ?');
    expect(sql).not.toContain('ANY(');
    const [, key, kind, minLat, maxLat, minLon, maxLon] =
      $queryRaw.mock.calls[0];
    expect(key).toBe('farmacia la estrella');
    expect(kind).toBe(GeoEntityKind.PLACE);
    expect(minLat).toBeLessThan(scope.latitude as number);
    expect(maxLat).toBeGreaterThan(scope.latitude as number);
    expect(minLon).toBeLessThan(scope.longitude as number);
    expect(maxLon).toBeGreaterThan(scope.longitude as number);
    // Only the matched ids are hydrated -- never the whole pool again.
    expect(findMany.mock.calls[1][0].where).toEqual({
      id: { in: ['geo-farmacia'] },
    });
  });

  it('reports a row matching both by canonical name and by remembered key once, as CANONICAL_NAME', async () => {
    const casa = row('geo-casa', 'Casa Mínima');
    const { service, findMany } = build({
      bboxRows: [casa],
      verifiedHintIds: ['geo-casa'],
    });

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'Casa Minima',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(scope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates.map((c) => [c.geoEntityId, c.matchKind])).toEqual([
      ['geo-casa', 'CANONICAL_NAME'],
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps multiplicity: the same remembered key on two in-scope GeoEntities returns BOTH (no first-wins)', async () => {
    const a = row('geo-sj-a', 'Parroquia San José');
    const b = row('geo-sj-b', 'Colegio San José');
    const { service } = build({
      bboxRows: [a, b],
      verifiedHintIds: ['geo-sj-a', 'geo-sj-b'],
      verifiedHintRows: [a, b],
    });

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: 'San José',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(scope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates.map((c) => c.geoEntityId)).toEqual([
      'geo-sj-a',
      'geo-sj-b',
    ]);
    expect(
      result.candidates.every((c) => c.matchKind === 'VERIFIED_HINT'),
    ).toBe(true);
  });

  it('never queries for a hint whose normalized key is empty', async () => {
    const { service, findMany, $queryRaw } = build({
      bboxRows: [],
      verifiedHintIds: [],
    });

    const result = await service.findGeoEntityCandidatesForHint({
      hintName: ' — ',
      expectedKind: GeoEntityKind.PLACE,
      window: geographicScopeSearchWindow(scope, 'DESTINATION_AREA')!,
    });

    expect(result.candidates).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    expect($queryRaw).not.toHaveBeenCalled();
  });

  describe('rememberVerifiedHintName', () => {
    function withExecuteRaw(affected: number) {
      const $executeRaw = jest.fn().mockResolvedValue(affected);
      return {
        service: new ExperienceCatalogService(
          { $executeRaw } as any,
          {} as any,
        ),
        $executeRaw,
      };
    }

    it('appends the verbatim text and its canonical key in ONE conditional UPDATE (atomic, idempotent)', async () => {
      const { service, $executeRaw } = withExecuteRaw(1);

      await expect(
        service.rememberVerifiedHintName(
          'geo-farmacia',
          'Farmacia la Estrella',
        ),
      ).resolves.toBe('REMEMBERED');

      expect($executeRaw).toHaveBeenCalledTimes(1);
      const sql = sqlOf($executeRaw);
      expect(sql).toContain(
        '"verifiedHintNames" = array_append("verifiedHintNames", ?)',
      );
      expect(sql).toContain(
        '"verifiedHintNameKeys" = array_append("verifiedHintNameKeys", ?)',
      );
      expect(sql).toContain('NOT ("verifiedHintNameKeys" @> ARRAY[?]::text[])');
      const [, name, key, id, guardKey] = $executeRaw.mock.calls[0];
      expect([name, key, id, guardKey]).toEqual([
        'Farmacia la Estrella',
        'farmacia la estrella',
        'geo-farmacia',
        'farmacia la estrella',
      ]);
    });

    it('reports ALREADY_REMEMBERED when the key was already present (0 rows updated)', async () => {
      const { service } = withExecuteRaw(0);

      await expect(
        service.rememberVerifiedHintName(
          'geo-farmacia',
          'Farmacia la Estrella',
        ),
      ).resolves.toBe('ALREADY_REMEMBERED');
    });

    it('writes nothing for a hint with an empty normalized key', async () => {
      const { service, $executeRaw } = withExecuteRaw(1);

      await expect(
        service.rememberVerifiedHintName('geo-x', '¡¿ !?'),
      ).resolves.toBe('EMPTY_KEY');
      expect($executeRaw).not.toHaveBeenCalled();
    });

    it.each([
      ['case', 'RECOLETA Cemetery', 'recoleta cemetery'],
      ['accents', 'El Zanjón de Granados', 'el zanjon de granados'],
      ['whitespace', '  Mafalda   Statue ', 'mafalda statue'],
      [
        'punctuation',
        'Mafalda, Susanita y Manolito',
        'mafalda susanita y manolito',
      ],
    ])(
      'keys with the existing normalizeGeoName semantics (%s), keeping the original text verbatim',
      async (_label, hint, expectedKey) => {
        const { service, $executeRaw } = withExecuteRaw(1);

        await service.rememberVerifiedHintName('geo-x', hint);

        const [, name, key] = $executeRaw.mock.calls[0];
        expect(name).toBe(hint);
        expect(key).toBe(expectedKey);
      },
    );
  });
});
