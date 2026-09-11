import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { FacetRetrievalService } from 'src/modules/tours/services/facet-retrieval.service';
import { RequestedFacet } from 'src/modules/tours/interfaces/preference-spec.interface';
import { getPrisma, resetDb, closeDb } from '../support/test-db';
import { seedVerifiedExperience } from '../support/seed';

/**
 * Task A6 integration coverage: FacetRetrievalService against real Postgres,
 * proving it reuses ExperienceCatalogService's canonical geography/hydration
 * boundary and does not lose a relevant row to arbitrary truncation.
 */
describe('tour-generation integration · facet retrieval (Task A6)', () => {
  let catalog: ExperienceCatalogService;
  let service: FacetRetrievalService;

  const CENTER = { latitude: -34.6083, longitude: -58.3712 };
  const HISTORY_FACET: RequestedFacet = {
    dimension: 'theme',
    key: 'history',
    weight: 1,
    source: 'wizard',
    required: false,
  };

  beforeAll(async () => {
    const prisma = await getPrisma();
    // Real services, only the external Places dependency stubbed.
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
    service = new FacetRetrievalService(catalog);
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('does not lose a relevant strong match among 500+ seeded Experiences to arbitrary truncation', async () => {
    const prisma = await getPrisma();

    // 500 unrelated, lower-quality filler rows clustered within ~30m of
    // the center -- all strictly closer than the real target below, so a
    // naive "closest N" truncation would push the target out of a small
    // window.
    const fillerBatchSize = 25;
    for (let batchStart = 0; batchStart < 500; batchStart += fillerBatchSize) {
      await Promise.all(
        Array.from(
          { length: Math.min(fillerBatchSize, 500 - batchStart) },
          (_, offset) => {
            const i = batchStart + offset;
            return seedVerifiedExperience(prisma, {
              canonicalName: `Filler Nightlife Spot ${i}`,
              latitude: CENTER.latitude + (((i * 37) % 200) - 100) * 0.0000015,
              longitude:
                CENTER.longitude + (((i * 53) % 200) - 100) * 0.0000015,
              themes: ['nightlife'],
              qualityScore: 2.0,
            });
          },
        ),
      );
    }

    // The one real, relevant Experience -- placed ~2 km from center (still
    // well within the 5 km query radius) so it ranks LAST by distance
    // among the 501 seeded rows.
    const strongHistoryId = await seedVerifiedExperience(prisma, {
      canonicalName: 'Cabildo de Buenos Aires',
      latitude: CENTER.latitude + 0.018,
      longitude: CENTER.longitude,
      themes: ['history'],
      qualityScore: 4.5,
    });

    const result = await service.retrieveFacetCandidates(HISTORY_FACET, {
      ...CENTER,
      radiusMeters: 5000,
    });

    expect(result.strongMatches).toContain(strongHistoryId);
    expect(result.satisfied).toBe(true);
  }, 60000);

  it('marks a facet satisfied when a single strong match exists', async () => {
    const prisma = await getPrisma();
    const id = await seedVerifiedExperience(prisma, {
      canonicalName: 'Museo Histórico Nacional',
      latitude: CENTER.latitude,
      longitude: CENTER.longitude,
      themes: ['history'],
      qualityScore: 4.0,
    });

    const result = await service.retrieveFacetCandidates(HISTORY_FACET, {
      ...CENTER,
      radiusMeters: 5000,
    });

    expect(result.strongMatches).toEqual([id]);
    expect(result.satisfied).toBe(true);
  });

  it('does not match a candidate whose name contains the facet key but whose themes do not', async () => {
    const prisma = await getPrisma();
    await seedVerifiedExperience(prisma, {
      canonicalName: 'History Bar & Grill', // name contains "History"...
      latitude: CENTER.latitude,
      longitude: CENTER.longitude,
      themes: ['food'], // ...but themes do not include "history".
      qualityScore: 4.5,
    });

    const result = await service.retrieveFacetCandidates(HISTORY_FACET, {
      ...CENTER,
      radiusMeters: 5000,
    });

    expect(result.strongMatches).toEqual([]);
    expect(result.weakMatches).toEqual([]);
    expect(result.satisfied).toBe(false);
  });

  it('never treats a bare/no-component row as a strong match, even when it thematically matches', async () => {
    const prisma = await getPrisma();
    const bare = await prisma.experience.create({
      data: {
        canonicalName: 'Bare Row (no components)',
        status: 'VERIFIED',
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
        qualityScore: 4.5,
        metadata: { themes: ['history'] },
      },
    });

    const result = await service.retrieveFacetCandidates(HISTORY_FACET, {
      ...CENTER,
      radiusMeters: 5000,
    });

    expect(result.strongMatches).not.toContain(bare.id);
    // Still relevant for ranking/enrichment per spec §6.1 -- a real
    // thematic match with no resolved geography lands in weak, not strong,
    // and not excluded entirely.
    expect(result.weakMatches).toContain(bare.id);
  });
});
