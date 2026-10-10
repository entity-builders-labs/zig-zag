import { TourGenerationHarness } from './support/harness';
import { seedTour, seedVerifiedExperience } from '../support/seed';

const DEST = { latitude: -34.6037, longitude: -58.3816 };

async function seedStandardExperiences(prisma: any) {
  for (let i = 0; i < 8; i++) {
    await seedVerifiedExperience(prisma, {
      canonicalName: `Historic site ${i}`,
      description: 'A verified historic landmark.',
      themes: ['history'],
      traits: ['iconic'],
      intents: ['visit'],
      latitude: DEST.latitude + i * 0.0006,
      longitude: DEST.longitude + i * 0.0006,
      qualityScore: 4.5,
      durationMinutes: 75,
    });
  }
}

async function seedStandardTour(prisma: any) {
  return seedTour(prisma, {
    destinationLabel: 'Buenos Aires',
    latitude: DEST.latitude,
    longitude: DEST.longitude,
    radiusMeters: 12000,
    days: 1,
    interests: ['history'],
    intents: ['visit'],
  });
}

describe('tour-generation integration · tour materialization persistence truth (Blocker 1)', () => {
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

  it('Test A (SUCCESS): records tour.materialization with PERSISTED outcome when DB transaction commits', async () => {
    await seedStandardExperiences(harness.prisma);
    const tourId = await seedStandardTour(harness.prisma);

    const outcome = await harness.generate(tourId);
    expect(outcome.error?.message ?? 'ok').toBe('ok');

    const tour = await harness.loadTour(tourId);
    expect(tour.generationStatus).toBe('completed');

    const trace = tour.trace;
    expect(trace).toBeDefined();
    expect(trace.version).toBe(5);
    expect(trace.result.status).toBe('COMPLETED');
    expect(trace.result.outcome).toBe('TOUR_EXPERIENCES_MATERIALIZED');

    const materializationStep = trace.steps.find(
      (s: any) => s.name === 'tour.materialization',
    );
    expect(materializationStep).toBeDefined();
    expect(materializationStep.decision?.status).toBe('PASS');
    expect(materializationStep.decision?.outcome).toBe(
      'TOUR_EXPERIENCES_PERSISTED',
    );
    expect(materializationStep.facts?.materializedCount).toBeGreaterThan(0);
    expect(materializationStep.facts?.experiences?.length).toBeGreaterThan(0);

    const experienceCount = await harness.prisma.tourExperience.count({
      where: { tourId },
    });
    expect(experienceCount).toBeGreaterThan(0);
    expect(materializationStep.facts?.materializedCount).toBe(experienceCount);
  });

  it('Test B (FAILURE): when TourExperience persistence fails, persists FAILED trace WITHOUT tour.materialization step', async () => {
    await seedStandardExperiences(harness.prisma);
    const tourId = await seedStandardTour(harness.prisma);

    const generationPrisma = (harness.generation as any).prisma;
    const originalTx = generationPrisma.$transaction.bind(generationPrisma);
    let simulatedFailureInjected = false;

    const txSpy = jest
      .spyOn(generationPrisma, '$transaction')
      .mockImplementation(async (arg: any, ...rest: any[]) => {
        if (typeof arg === 'function' && !simulatedFailureInjected) {
          return originalTx(async (realTx: any) => {
            const proxyTx = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'tourExperience') {
                  const te = target.tourExperience;
                  return new Proxy(te, {
                    get(teTarget, teProp) {
                      if (teProp === 'create') {
                        return jest.fn().mockImplementation(async () => {
                          simulatedFailureInjected = true;
                          throw new Error(
                            'Simulated database write failure during TourExperience materialization',
                          );
                        });
                      }
                      return Reflect.get(teTarget, teProp);
                    },
                  });
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return arg(proxyTx);
          });
        }
        return originalTx(arg, ...rest);
      });

    try {
      const outcome = await harness.generate(tourId);
      expect(outcome.ok).toBe(false);
      expect(outcome.error?.message).toContain(
        'Simulated database write failure',
      );
      expect(simulatedFailureInjected).toBe(true);

      const tour = await harness.loadTour(tourId);
      expect(tour.generationStatus).toBe('failed');

      const trace = tour.trace;
      expect(trace).toBeDefined();
      expect(trace.version).toBe(5);
      expect(trace.result.status).toBe('FAILED');
      expect(trace.result.outcome).toBe('GENERATION_FAILED');
      expect(trace.result.reason).toContain('Simulated database write failure');

      // CRITICAL INVARIANT: The trace MUST NOT contain tour.materialization because persistence did not succeed!
      const materializationStep = trace.steps.find(
        (s: any) => s.name === 'tour.materialization',
      );
      expect(materializationStep).toBeUndefined();

      // Verify no partially-created TourExperience rows exist
      const experienceCount = await harness.prisma.tourExperience.count({
        where: { tourId },
      });
      expect(experienceCount).toBe(0);
    } finally {
      txSpy.mockRestore();
    }
  });

  it('Test C (FAILURE): when metadata update fails inside materialization transaction, rolls back TourExperiences and trace', async () => {
    await seedStandardExperiences(harness.prisma);
    const tourId = await seedStandardTour(harness.prisma);

    const generationPrisma = (harness.generation as any).prisma;
    const originalTx = generationPrisma.$transaction.bind(generationPrisma);
    let teCreated = false;
    let simulatedFailureInjected = false;

    const txSpy = jest
      .spyOn(generationPrisma, '$transaction')
      .mockImplementation(async (arg: any, ...rest: any[]) => {
        if (typeof arg === 'function') {
          return originalTx(async (realTx: any) => {
            const proxyTx = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'tourExperience') {
                  const te = target.tourExperience;
                  return new Proxy(te, {
                    get(teTarget, teProp) {
                      if (teProp === 'create') {
                        return async (...createArgs: any[]) => {
                          const result = await teTarget.create(...createArgs);
                          teCreated = true;
                          return result;
                        };
                      }
                      return Reflect.get(teTarget, teProp);
                    },
                  });
                }
                if (prop === 'tour') {
                  const t = target.tour;
                  return new Proxy(t, {
                    get(tTarget, tProp) {
                      if (tProp === 'update') {
                        return async (...updateArgs: any[]) => {
                          if (teCreated && !simulatedFailureInjected) {
                            simulatedFailureInjected = true;
                            throw new Error(
                              'Simulated database write failure during Tour metadata update inside materialization transaction',
                            );
                          }
                          return tTarget.update(...updateArgs);
                        };
                      }
                      return Reflect.get(tTarget, tProp);
                    },
                  });
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return arg(proxyTx);
          });
        }
        return originalTx(arg, ...rest);
      });

    try {
      const outcome = await harness.generate(tourId);
      expect(outcome.ok).toBe(false);
      expect(outcome.error?.message).toContain(
        'Simulated database write failure during Tour metadata update inside materialization transaction',
      );
      expect(simulatedFailureInjected).toBe(true);

      const tour = await harness.loadTour(tourId);
      expect(tour.generationStatus).toBe('failed');

      const trace = tour.trace;
      expect(trace).toBeDefined();
      expect(trace.version).toBe(5);
      expect(trace.result.status).toBe('FAILED');
      expect(trace.result.outcome).toBe('GENERATION_FAILED');
      expect(trace.result.reason).toContain(
        'Simulated database write failure during Tour metadata update inside materialization transaction',
      );

      // CRITICAL INVARIANT: Entire transaction rolled back -> NO tour.materialization step in trace
      const materializationStep = trace.steps.find(
        (s: any) => s.name === 'tour.materialization',
      );
      expect(materializationStep).toBeUndefined();

      // CRITICAL INVARIANT: Entire transaction rolled back -> NO TourExperience rows committed
      const experienceCount = await harness.prisma.tourExperience.count({
        where: { tourId },
      });
      expect(experienceCount).toBe(0);

      // Verify sequence numbering and IDs remain sane after checkpoint rollback
      const sequences = trace.steps.map((s: any) => s.sequence);
      for (let i = 0; i < sequences.length; i++) {
        expect(sequences[i]).toBe(i + 1);
      }
      const ids = trace.steps.map((s: any) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      txSpy.mockRestore();
    }
  });

  it('Test D (POST-COMMIT FAILURE): when failure occurs after materialization transaction committed, preserves truthful PERSISTED step', async () => {
    await seedStandardExperiences(harness.prisma);
    const tourId = await seedStandardTour(harness.prisma);

    const generationPrisma = (harness.generation as any).prisma;
    const originalTx = generationPrisma.$transaction.bind(generationPrisma);
    let simulatedFailureInjected = false;

    const txSpy = jest
      .spyOn(generationPrisma, '$transaction')
      .mockImplementation(async (arg: any, ...rest: any[]) => {
        if (typeof arg === 'function') {
          return originalTx(async (realTx: any) => {
            const proxyTx = new Proxy(realTx, {
              get(target, prop, receiver) {
                if (prop === 'tour') {
                  const t = target.tour;
                  return new Proxy(t, {
                    get(tTarget, tProp) {
                      if (tProp === 'update') {
                        return async (...updateArgs: any[]) => {
                          const data = updateArgs[0]?.data;
                          // Fail only the final TourCompleted transaction, NOT the materialization or failure handlers
                          if (
                            data?.metadata?.generationStatus === 'completed' &&
                            !simulatedFailureInjected
                          ) {
                            simulatedFailureInjected = true;
                            throw new Error(
                              'Simulated failure during post-materialization completion transaction',
                            );
                          }
                          return tTarget.update(...updateArgs);
                        };
                      }
                      return Reflect.get(tTarget, tProp);
                    },
                  });
                }
                return Reflect.get(target, prop, receiver);
              },
            });
            return arg(proxyTx);
          });
        }
        return originalTx(arg, ...rest);
      });

    try {
      const outcome = await harness.generate(tourId);
      expect(outcome.ok).toBe(false);
      expect(outcome.error?.message).toContain(
        'Simulated failure during post-materialization completion transaction',
      );
      expect(simulatedFailureInjected).toBe(true);

      const tour = await harness.loadTour(tourId);
      expect(tour.generationStatus).toBe('failed');

      // CRITICAL INVARIANT: Materialization transaction already COMMITTED before later failure
      // TourExperience rows remain in DB
      const experienceCount = await harness.prisma.tourExperience.count({
        where: { tourId },
      });
      expect(experienceCount).toBeGreaterThan(0);

      // FAILED trace truthfully retains the successful materialization step
      const trace = tour.trace;
      expect(trace).toBeDefined();
      expect(trace.version).toBe(5);
      expect(trace.result.status).toBe('FAILED');
      expect(trace.result.outcome).toBe('GENERATION_FAILED');
      expect(trace.result.reason).toContain(
        'Simulated failure during post-materialization completion transaction',
      );

      const materializationStep = trace.steps.find(
        (s: any) => s.name === 'tour.materialization',
      );
      expect(materializationStep).toBeDefined();
      expect(materializationStep.decision?.status).toBe('PASS');
      expect(materializationStep.decision?.outcome).toBe(
        'TOUR_EXPERIENCES_PERSISTED',
      );
      expect(materializationStep.facts?.materializedCount).toBe(
        experienceCount,
      );
    } finally {
      txSpy.mockRestore();
    }
  });
});
