import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { getPrisma, resetDb, closeDb } from '../support/test-db';
import { seedVerifiedExperience } from '../support/seed';

/**
 * The durable `test:integration` category runs real internal components
 * (PrismaService, ExperienceCatalogService, the resolver, …) against a real
 * Postgres, with external transports faked. This first spec proves the DB
 * seam itself: a seeded VERIFIED Experience is retrieved by the real
 * `ExperienceCatalogService.findVerifiedWithin` geography query, and rows
 * outside the radius or not VERIFIED are excluded.
 *
 * The full acquisition → resolver → Prisma persistence → catalog re-query →
 * ranking → planner → feasibility → materialization orchestration specs
 * (canonical-orchestration, catalog-reuse, acquisition-degradation,
 * places-admission, long-tail, day-trip, no-direct-persistence,
 * duplicate-delivery, routing-boundary) live alongside this file and build on
 * the same support/ helpers.
 */
describe('tour-generation integration · catalog retrieval', () => {
  let catalog: ExperienceCatalogService;

  beforeAll(async () => {
    const prisma = await getPrisma();
    // Real service, only its external Places dependency stubbed.
    catalog = new ExperienceCatalogService(prisma, {
      getStatus: () => ({ provider: 'none' }),
    } as any);
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('retrieves a seeded VERIFIED Experience within the radius, in real Postgres', async () => {
    const prisma = await getPrisma();
    const nearId = await seedVerifiedExperience(prisma, {
      canonicalName: 'Plaza de Mayo',
      latitude: -34.6083,
      longitude: -58.3712,
      themes: ['history'],
      traits: ['iconic'],
    });
    // ~10 km away — outside a 3 km radius.
    await seedVerifiedExperience(prisma, {
      canonicalName: 'Far Away Museum',
      latitude: -34.52,
      longitude: -58.48,
      themes: ['history'],
    });

    const found = await catalog.findVerifiedWithin(
      -34.6083,
      -58.3712,
      3000,
      50,
    );

    const ids = found.map((experience: any) => experience.id);
    expect(ids).toContain(nearId);
    expect(ids).not.toContain('Far Away Museum');
    const near = found.find((experience: any) => experience.id === nearId);
    expect(near.canonicalName).toBe('Plaza de Mayo');
    expect(near.themes).toContain('history');
    expect(near.traits).toContain('iconic');
    expect(near.components?.length).toBeGreaterThanOrEqual(1);
  });

  it('excludes non-VERIFIED rows', async () => {
    const prisma = await getPrisma();
    await seedVerifiedExperience(prisma, {
      canonicalName: 'Verified Landmark',
      latitude: -34.6083,
      longitude: -58.3712,
    });
    const geo = await prisma.geoEntity.create({
      data: {
        name: 'Pending Landmark',
        kind: 'PLACE',
        latitude: -34.6083,
        longitude: -58.3712,
      },
    });
    await prisma.experience.create({
      data: {
        canonicalName: 'Pending Landmark',
        status: 'PENDING',
        latitude: -34.6083,
        longitude: -58.3712,
        components: {
          create: [{ geoEntityId: geo.id, order: 0, required: true }],
        },
      },
    });

    const found = await catalog.findVerifiedWithin(
      -34.6083,
      -58.3712,
      3000,
      50,
    );
    expect(found.map((experience: any) => experience.canonicalName)).toEqual([
      'Verified Landmark',
    ]);
  });
});
