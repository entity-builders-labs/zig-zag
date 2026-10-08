import { TourGenerationHarness } from './support/harness';
import { osmPoi } from './support/fakes';
import { seedTour, seedVerifiedExperience } from '../support/seed';

/**
 * GATHER → RECONCILE → FREEZE → PLAN through the real orchestration and real
 * Postgres. A sufficient catalog leaves residual planner capacity, so the
 * bounded PLANNER_CAPACITY acquisition persists a new Experience. That
 * Experience must reach the FINAL catalog snapshot, the final ranking and
 * the final plan: the provisional (pre-refill) plan never becomes the Tour.
 */
const DEST = { latitude: -34.6037, longitude: -58.3816 };
const REFILL_NAME = 'Museo de la Ciudad';

describe('tour-generation integration · gather → reconcile → plan', () => {
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

  const seedSufficientShortCatalog = async () => {
    for (let i = 0; i < 4; i++) {
      await seedVerifiedExperience(harness.prisma, {
        canonicalName: `Casco histórico stop ${i}`,
        description: 'A verified historic landmark in the old town.',
        themes: ['history'],
        traits: ['iconic'],
        intents: ['visit'],
        latitude: DEST.latitude + i * 0.0006,
        longitude: DEST.longitude + i * 0.0006,
        // Explicitly strong on the canonical 0..5 scale, and short, so the
        // day keeps meaningful residual capacity after every promotion.
        qualityScore: 4.5,
        durationMinutes: 30,
      });
    }
  };

  const configureRefill = () =>
    harness.configure({
      groundedSearch: { evidence: [{ key: 'web:refill:1' }] },
      discoveryExtractor: {
        candidates: [
          {
            name: REFILL_NAME,
            themes: ['history'],
            traits: ['iconic'],
            intents: ['visit'],
            evidenceKeys: ['web:refill:1'],
          },
        ],
      },
      osm: {
        pois: [
          osmPoi(REFILL_NAME, DEST.latitude + 0.003, DEST.longitude + 0.002),
        ],
      },
    });

  const generate = async () => {
    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });
    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');
    return harness.loadTour(tourId);
  };

  it('6/7/9/10/11/20. a PLANNER_CAPACITY Experience reaches the fresh final snapshot, ranking and plan', async () => {
    await seedSufficientShortCatalog();
    configureRefill();

    const tour = await generate();
    const steps = harness.traceSteps(tour.trace);
    const refill = await harness.prisma.experience.findFirst({
      where: { canonicalName: REFILL_NAME },
    });
    expect(refill).not.toBeNull();
    const refillId = refill!.id;

    const indexOf = (predicate: (step: any) => boolean) =>
      steps.findIndex(predicate);
    const provisional = indexOf(
      (step) =>
        step.name === 'planning.provisional' &&
        step.facts.refillAuthorized === true,
    );
    const refillPass = indexOf(
      (step) => step.id === 'acquisition-pass-1-planner_capacity',
    );
    const gatherComplete = indexOf(
      (step) =>
        step.name === 'generation.gather' &&
        step.facts.boundary === 'GATHER_COMPLETE',
    );
    const finalSnapshot = indexOf(
      (step) =>
        step.name === 'catalog.snapshot' && step.facts.phase === 'FINAL',
    );
    const finalRanking = indexOf(
      (step) => step.name === 'candidate_pool.selection',
    );
    const finalPlan = indexOf((step) => step.name === 'planning.daily');
    const finalSelection = indexOf((step) => step.name === 'selection.final');

    // 9/10/11: the provisional plan precedes the refill; the final snapshot,
    // ranking and plan all come after GATHER_COMPLETE, in that order.
    expect(provisional).toBeGreaterThanOrEqual(0);
    expect([
      provisional,
      refillPass,
      gatherComplete,
      finalSnapshot,
      finalRanking,
      finalPlan,
      finalSelection,
    ]).toEqual(
      [
        provisional,
        refillPass,
        gatherComplete,
        finalSnapshot,
        finalRanking,
        finalPlan,
        finalSelection,
      ].sort((a, b) => a - b),
    );
    expect(refillPass).toBeGreaterThan(provisional);
    expect(steps.filter((step) => step.name === 'planning.daily')).toHaveLength(
      1,
    );

    // 6: the refill-persisted Experience is in the FINAL snapshot (and was
    // not in the INITIAL one), read at the final acquisition epoch.
    const initial = steps.find(
      (step) =>
        step.name === 'catalog.snapshot' && step.facts.phase === 'INITIAL',
    );
    expect(initial.facts.eligibleExperienceIds).not.toContain(refillId);
    expect(steps[finalSnapshot].facts.eligibleExperienceIds).toContain(
      refillId,
    );
    expect(steps[finalSnapshot].facts.acquisitionEpoch).toBe(
      steps[gatherComplete].facts.acquisitionEpoch,
    );
    expect(steps[gatherComplete].facts.affectedExperienceIds).toContain(
      refillId,
    );

    // 7/10: it got the same ranking/composition opportunity.
    expect(
      steps[finalRanking].subjects.map((subject: any) => subject.subject.id),
    ).toContain(refillId);

    // 20: the trace states what happened to it after the refill.
    const refillSubject = steps[finalSelection].subjects.find(
      (subject: any) => subject.subject.id === refillId,
    );
    expect(refillSubject).toBeDefined();
    expect(refillSubject.decision.outcome).toBe('PLANNED');

    // 11: the Tour is exactly the final (post-reconciliation) plan.
    expect(
      tour.tourExperiences.map((experience) => experience.experienceId).sort(),
    ).toEqual([...steps[finalSelection].facts.plannedExperienceIds].sort());
    expect(
      tour.tourExperiences.some(
        (experience) => experience.experienceId === refillId,
      ),
    ).toBe(true);
  });

  it('without any acquisition, the initial snapshot is the final one and no provisional plan is recorded', async () => {
    for (let i = 0; i < 8; i++) {
      await seedVerifiedExperience(harness.prisma, {
        canonicalName: `Casco histórico stop ${i}`,
        description: 'A verified historic landmark in the old town.',
        themes: ['history'],
        traits: ['iconic'],
        intents: ['visit'],
        latitude: DEST.latitude + i * 0.0006,
        longitude: DEST.longitude + i * 0.0006,
        qualityScore: 4.5,
        durationMinutes: 75,
      });
    }

    const tour = await generate();
    const steps = harness.traceSteps(tour.trace);
    const snapshots = steps.filter((step) => step.name === 'catalog.snapshot');
    expect(snapshots.map((step) => step.facts.phase)).toEqual([
      'INITIAL',
      'FINAL',
    ]);
    expect(snapshots[1].facts.acquisitionEpoch).toBe(0);
    expect(snapshots[1].facts.eligibleExperienceIds).toEqual(
      snapshots[0].facts.eligibleExperienceIds,
    );
    expect(steps.some((step) => step.name === 'planning.provisional')).toBe(
      false,
    );
    expect(harness.fakes.groundedSearch.search).not.toHaveBeenCalled();
  });
});
