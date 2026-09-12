import { ExperienceCatalogService } from 'src/modules/tours/services/experience-catalog.service';
import { getPrisma, resetDb, closeDb } from '../support/test-db';
import {
  seedVerifiedExperience,
  bulkSeedFillerExperiences,
} from '../support/seed';

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

  /**
   * Task A6.1 — PostGIS geospatial catalog boundary review fix
   * (docs/superpowers/plans/2026-09-11-a6-1-postgis-geospatial-catalog-boundary.md).
   *
   * `findVerifiedWithinForMatching` replaces the old
   * `FACET_RETRIEVAL_LIMIT = 2000` workaround over the bounded
   * `findVerifiedWithin` scan. These tests would fail against that old
   * bounded implementation.
   */
  describe('findVerifiedWithinForMatching (Task A6.1 — PostGIS boundary)', () => {
    const CENTER = { latitude: -34.6083, longitude: -58.3712 };

    it('returns a relevant Experience placed beyond the old closest-2000 selection window', async () => {
      const prisma = await getPrisma();

      // 2001 filler rows tightly clustered (~tens of meters) around the
      // center -- all strictly closer than the real target below, so the
      // old `findVerifiedWithin(..., 2000)` boundary would have dropped
      // the target from its closest-2000 distance slice.
      await bulkSeedFillerExperiences(prisma, {
        count: 2001,
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
      });

      const targetId = await seedVerifiedExperience(prisma, {
        canonicalName: 'Cabildo de Buenos Aires',
        latitude: CENTER.latitude + 0.018, // ~2 km away -- farthest of all 2002 rows
        longitude: CENTER.longitude,
        themes: ['history'],
        qualityScore: 4.5,
      });

      const found = await catalog.findVerifiedWithinForMatching(
        CENTER.latitude,
        CENTER.longitude,
        5000,
      );

      expect(found.map((experience: any) => experience.id)).toContain(targetId);
    }, 60000);

    it('returns a relevant in-scope Experience even when its id would sort after every row an old id-ordered global scan cap would have read', async () => {
      const prisma = await getPrisma();

      // The old ExperienceCatalogService.findVerifiedWithin scans
      // `take: scanLimit` rows ordered by `id ASC` *before* any radius
      // filtering (scanLimit = max(limit*4, 1000); A6's old
      // FACET_RETRIEVAL_LIMIT=2000 call made that 8000). 8001 filler
      // rows -- scattered broadly (~+-0.5deg, ~55km, mostly outside a
      // 5km radius) so this also isn't just a "closest wins" case --
      // plus a target whose id is the lexicographically maximal
      // UUID-shaped string (guaranteed to sort after every random v4
      // UUID) makes this deterministic: no old id-ordered `take` below
      // the full row count could ever have reached the target's row.
      await bulkSeedFillerExperiences(prisma, {
        count: 8001,
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
        scatterDegrees: 0.5,
      });

      const targetId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      await seedVerifiedExperience(prisma, {
        id: targetId,
        canonicalName: 'Museo Histórico Nacional',
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
        themes: ['history'],
        qualityScore: 4.0,
      });

      const found = await catalog.findVerifiedWithinForMatching(
        CENTER.latitude,
        CENTER.longitude,
        5000,
      );

      expect(found.map((experience: any) => experience.id)).toContain(targetId);
    }, 60000);

    it('excludes an Experience whose only component is outside the radius, includes one inside', async () => {
      const prisma = await getPrisma();
      const insideId = await seedVerifiedExperience(prisma, {
        canonicalName: 'Inside Radius',
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
        themes: ['history'],
      });
      const outsideId = await seedVerifiedExperience(prisma, {
        canonicalName: 'Outside Radius',
        latitude: CENTER.latitude + 0.5, // ~55 km away
        longitude: CENTER.longitude,
        themes: ['history'],
      });

      const found = await catalog.findVerifiedWithinForMatching(
        CENTER.latitude,
        CENTER.longitude,
        5000,
      );

      const ids = found.map((experience: any) => experience.id);
      expect(ids).toContain(insideId);
      expect(ids).not.toContain(outsideId);
    });

    it('orders a multi-component Experience by its NEAREST component, not its farthest one -- and ahead of a farther single-component Experience', async () => {
      const prisma = await getPrisma();
      // Multi: BOTH components inside the radius, at two different
      // distances -- ~111 m and ~1002 m -- so the aggregate genuinely has
      // two candidate values to choose between (unlike a component outside
      // the radius entirely, which the WHERE ST_DWithin clause would
      // already filter out row-by-row before any aggregate runs, making
      // MIN and MAX indistinguishable). MIN(distance) = ~111 m;
      // MAX(distance) = ~1002 m.
      const multiId = await seedVerifiedExperience(prisma, {
        canonicalName: 'Multi-component Walk',
        latitude: CENTER.latitude + 0.009, // ~1002 m -- the primary component
        longitude: CENTER.longitude,
        themes: ['history'],
        extraComponents: [
          {
            name: 'Near Stop',
            latitude: CENTER.latitude + 0.001, // ~111 m
            longitude: CENTER.longitude,
          },
        ],
      });

      // Comparison: single component ~501 m away -- farther than the
      // multi's NEAREST component (~111 m) but nearer than its FARTHEST
      // one (~1002 m). Only the MIN-based contract puts the multi first.
      const comparisonId = await seedVerifiedExperience(prisma, {
        canonicalName: 'Single-component Museum',
        latitude: CENTER.latitude + 0.0045, // ~501 m
        longitude: CENTER.longitude,
        themes: ['history'],
      });

      const found = await catalog.findVerifiedWithinForMatching(
        CENTER.latitude,
        CENTER.longitude,
        5000,
      );

      const relevantIds = found
        .map((experience: any) => experience.id)
        .filter((id: string) => id === multiId || id === comparisonId);

      // Both are in scope, but MIN(distance(multi's components)) (~111 m)
      // is less than distance(comparison) (~501 m), which in turn is less
      // than MAX(distance(multi's components)) (~1002 m). Ordering the
      // multi-component Experience first is only correct under a genuine
      // MIN contract -- a MAX (or "primary component only") distance would
      // order the comparison first instead. This is the second half of
      // the contract that plain membership doesn't demonstrate.
      expect(relevantIds).toEqual([multiId, comparisonId]);
    });

    it('breaks identical-distance ties deterministically by Experience id', async () => {
      const prisma = await getPrisma();
      // Two Experiences at the exact same coordinates -> identical distance.
      const a = await seedVerifiedExperience(prisma, {
        canonicalName: 'Tie A',
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
        themes: ['history'],
      });
      const b = await seedVerifiedExperience(prisma, {
        canonicalName: 'Tie B',
        latitude: CENTER.latitude,
        longitude: CENTER.longitude,
        themes: ['history'],
      });

      const found = await catalog.findVerifiedWithinForMatching(
        CENTER.latitude,
        CENTER.longitude,
        5000,
      );

      const tiedIds = found
        .map((experience: any) => experience.id)
        .filter((id: string) => id === a || id === b);
      expect(tiedIds).toEqual([a, b].sort());
    });

    it('never returns a bare/no-component Experience -- the join itself excludes it', async () => {
      const prisma = await getPrisma();
      await prisma.experience.create({
        data: {
          canonicalName: 'Bare Row (no components)',
          status: 'VERIFIED',
          latitude: CENTER.latitude,
          longitude: CENTER.longitude,
          metadata: { themes: ['history'] },
        },
      });

      const found = await catalog.findVerifiedWithinForMatching(
        CENTER.latitude,
        CENTER.longitude,
        5000,
      );

      expect(found).toHaveLength(0);
    });
  });
});
