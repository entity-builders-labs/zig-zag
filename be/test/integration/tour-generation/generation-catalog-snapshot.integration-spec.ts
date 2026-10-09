import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import {
  bulkSeedFillerExperiences,
  seedTour,
  seedVerifiedExperience,
} from '../support/seed';
import { GeographicScope } from '../../../src/modules/tours/interfaces/experience-resolution.interface';
import { isTourEligibleForDestinationRequest } from '../../../src/modules/tours/utils/tour-destination-eligibility.policy';

/**
 * PF-REV-SNAPSHOT-WINDOW-1: the generation catalog snapshot reads the
 * canonical PostGIS boundary (`findVerifiedWithinForMatching`), the same
 * one coverage reads, so geographic scope is decided by the database:
 *  - no global, id-ordered scan cap before geography (the old
 *    `take: 1000` hid an in-radius row behind 1000 unrelated ones);
 *  - no nearest-250 distance slice before composition/ranking;
 *  - destination eligibility and the explicit-id merge are unchanged, and
 *    the snapshot stays ordered by id.
 * Spec: docs/superpowers/specs/2026-09-11-postgis-geospatial-catalog-boundary.md
 */
const DEST = { latitude: -34.6037, longitude: -58.3816 };
const RADIUS_METERS = 5_000;
const WINDOW = { ...DEST, radiusMeters: RADIUS_METERS };
const DESTINATION: GeographicScope = {
  kind: 'POINT_RADIUS',
  latitude: DEST.latitude,
  longitude: DEST.longitude,
  radiusMeters: RADIUS_METERS,
};
// Sorts after every random v4 UUID and after every `idPrefix` filler.
const LAST_SORTING_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
// ~111 km north: outside every radius used here.
const FAR_AWAY = { latitude: DEST.latitude + 1, longitude: DEST.longitude };

describe('tour-generation integration · generation catalog snapshot window', () => {
  let harness: TourGenerationHarness;

  beforeAll(async () => {
    harness = await TourGenerationHarness.create();
  });
  afterAll(async () => {
    await harness.close();
  });
  beforeEach(async () => {
    await harness.reset();
  });

  const readSnapshot = (explicitIds: string[] = []) =>
    (harness.generation as any).readCatalogSnapshot({
      phase: 'FINAL',
      acquisitionEpoch: 0,
      window: WINDOW,
      destination: DESTINATION,
      explicitIds,
    });
  const snapshotIds = async (explicitIds: string[] = []) =>
    (await readSnapshot(explicitIds)).experiences.map(
      (experience: { id: string }) => experience.id,
    );

  it('A. sees an in-radius Experience whose id sorts after 1000 unrelated VERIFIED rows', async () => {
    await bulkSeedFillerExperiences(harness.prisma, {
      count: 1000,
      ...FAR_AWAY,
      idPrefix: '00000000',
    });
    await seedVerifiedExperience(harness.prisma, {
      id: LAST_SORTING_ID,
      canonicalName: 'Museo Histórico Nacional',
      ...DEST,
      themes: ['history'],
      qualityScore: 4,
    });

    expect(await snapshotIds()).toEqual([LAST_SORTING_ID]);
  }, 120_000);

  it('C. keeps an in-radius Experience that is 251st by distance (no pre-ranking nearest-250 slice)', async () => {
    // 260 rows within tens of meters of the center: all nearer than the
    // target, which is the farthest in-radius row (~2 km).
    await bulkSeedFillerExperiences(harness.prisma, { count: 260, ...DEST });
    const targetId = await seedVerifiedExperience(harness.prisma, {
      canonicalName: 'Cabildo de Buenos Aires',
      latitude: DEST.latitude + 0.018,
      longitude: DEST.longitude,
      themes: ['history'],
      qualityScore: 4.5,
    });

    const ids = await snapshotIds();

    expect(ids).toHaveLength(261);
    expect(ids).toContain(targetId);
    // Canonical snapshot order is by id, not by PostGIS distance.
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  }, 120_000);

  it('D. every row the PostGIS boundary scopes in and the destination admits is in the snapshot', async () => {
    await bulkSeedFillerExperiences(harness.prisma, {
      count: 1001,
      ...FAR_AWAY,
      idPrefix: '00000000',
    });
    await bulkSeedFillerExperiences(harness.prisma, { count: 260, ...DEST });
    await seedVerifiedExperience(harness.prisma, {
      id: LAST_SORTING_ID,
      canonicalName: 'Museo Histórico Nacional',
      ...DEST,
      themes: ['history'],
    });
    // In PostGIS scope through its nearer component, but it leaves the
    // destination: destination eligibility, not geography, excludes it.
    const extendsBeyondId = await seedVerifiedExperience(harness.prisma, {
      canonicalName: 'Walk leaving the destination',
      latitude: DEST.latitude + 0.09, // ~10 km
      longitude: DEST.longitude,
      themes: ['history'],
      extraComponents: [
        {
          name: 'Stop inside',
          latitude: DEST.latitude + 0.001,
          longitude: DEST.longitude,
        },
      ],
    });

    const scoped = await harness.catalog.findVerifiedWithinForMatching(
      WINDOW.latitude,
      WINDOW.longitude,
      WINDOW.radiusMeters,
    );
    const expected = scoped
      .filter((row) => isTourEligibleForDestinationRequest(row, DESTINATION))
      .map((row) => row.id)
      .sort((a, b) => a.localeCompare(b));

    expect(scoped.map((row) => row.id)).toContain(extendsBeyondId);
    expect(expected).not.toContain(extendsBeyondId);
    expect(expected).toContain(LAST_SORTING_ID);
    expect(await snapshotIds()).toEqual(expected);
  }, 120_000);

  it('explicit ids are still merged into the snapshot from outside the window', async () => {
    const anchoredId = await seedVerifiedExperience(harness.prisma, {
      canonicalName: 'Named venue far away',
      ...FAR_AWAY,
      themes: ['history'],
    });
    const insideId = await seedVerifiedExperience(harness.prisma, {
      canonicalName: 'Plaza de Mayo',
      ...DEST,
      themes: ['history'],
    });

    expect(await snapshotIds([anchoredId])).toEqual(
      [anchoredId, insideId].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('B. a PLANNER_CAPACITY Experience persisted late is in the fresh final snapshot despite >1000 unrelated global rows', async () => {
    // The sufficient catalog sorts first and the unrelated rows next, so a
    // global id-ordered `take: 1000` would read the catalog plus 996
    // unrelated rows and never reach the late (random-id) Experience.
    for (let i = 0; i < 4; i++) {
      await seedVerifiedExperience(harness.prisma, {
        id: `00000000-0000-0000-0000-00000000000${i}`,
        canonicalName: `Casco histórico stop ${i}`,
        description: 'A verified historic landmark in the old town.',
        themes: ['history'],
        traits: ['iconic'],
        intents: ['visit'],
        latitude: DEST.latitude + i * 0.0006,
        longitude: DEST.longitude + i * 0.0006,
        qualityScore: 4.5,
        durationMinutes: 30,
      });
    }
    await bulkSeedFillerExperiences(harness.prisma, {
      count: 1001,
      ...FAR_AWAY,
      idPrefix: '00000001',
    });
    const refillName = 'Museo de la Ciudad';
    harness.configure({
      groundedSearch: { evidence: [{ key: 'web:refill:1' }] },
      discoveryExtractor: {
        candidates: [
          {
            name: refillName,
            themes: ['history'],
            traits: ['iconic'],
            intents: ['visit'],
            evidenceKeys: ['web:refill:1'],
          },
        ],
      },
      osm: {
        pois: [
          osmPoi(refillName, DEST.latitude + 0.003, DEST.longitude + 0.002),
        ],
      },
    });
    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      ...DEST,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    const refill = await harness.prisma.experience.findFirst({
      where: { canonicalName: refillName, status: 'VERIFIED' },
    });
    expect(refill).not.toBeNull();
    expect(
      await harness.prisma.experience.count({ where: { status: 'VERIFIED' } }),
    ).toBeGreaterThan(1001);

    const tour = await harness.loadTour(tourId);
    const steps = harness.traceSteps(tour.trace);
    const gatherComplete = steps.find(
      (step: any) =>
        step.name === 'generation.gather' &&
        step.facts.boundary === 'GATHER_COMPLETE',
    );
    const finalSnapshot = steps.find(
      (step: any) =>
        step.name === 'catalog.snapshot' && step.facts.phase === 'FINAL',
    );
    expect(gatherComplete.facts.affectedExperienceIds).toContain(refill!.id);
    expect(finalSnapshot.facts.acquisitionEpoch).toBeGreaterThanOrEqual(
      gatherComplete.facts.acquisitionEpoch,
    );
    expect(finalSnapshot.facts.eligibleExperienceIds).toContain(refill!.id);
  }, 180_000);
});
