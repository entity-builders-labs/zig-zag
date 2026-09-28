import { TourGenerationHarness } from './support/harness';
import { seedTour, seedVerifiedExperience } from '../support/seed';

const DEST = { latitude: -34.6037, longitude: -58.3816 };

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

  it('SUCCESS: records tour.materialization with PERSISTED outcome when DB transaction commits', async () => {
    for (let i = 0; i < 8; i++) {
      await seedVerifiedExperience(harness.prisma, {
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

    const tour = await harness.loadTour(tourId);
    expect(tour.generationStatus).toBe('completed');

    const trace = tour.trace;
    expect(trace).toBeDefined();
    expect(trace.version).toBe(5);
    expect(trace.result.status).toBe('COMPLETED');
    expect(trace.result.outcome).toBe('TOUR_EXPERIENCES_MATERIALIZED');

    const materializationStep = trace.steps.find((s: any) => s.name === 'tour.materialization');
    expect(materializationStep).toBeDefined();
    expect(materializationStep.decision?.status).toBe('PASS');
    expect(materializationStep.decision?.outcome).toBe('TOUR_EXPERIENCES_PERSISTED');
    expect(materializationStep.facts?.materializedCount).toBeGreaterThan(0);
    expect(materializationStep.facts?.experiences?.length).toBeGreaterThan(0);
  });

  it('FAILURE: when TourExperience persistence fails, persists FAILED trace WITHOUT tour.materialization step', async () => {
    for (let i = 0; i < 8; i++) {
      await seedVerifiedExperience(harness.prisma, {
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

    const tourId = await seedTour(harness.prisma, {
      destinationLabel: 'Buenos Aires',
      latitude: DEST.latitude,
      longitude: DEST.longitude,
      radiusMeters: 12000,
      days: 1,
      interests: ['history'],
      intents: ['visit'],
    });

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
                          throw new Error('Simulated database write failure during TourExperience materialization');
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
      expect(outcome.error?.message).toContain('Simulated database write failure');
      expect(simulatedFailureInjected).toBe(true);

      const tour = await harness.loadTour(tourId);
      expect(tour.generationStatus).toBe('failed');

      const trace = tour.trace;
      expect(trace).toBeDefined();
      expect(trace.version).toBe(5);
      expect(trace.result.status).toBe('FAILED');
      expect(trace.result.outcome).toBe('GENERATION_FAILED');
      expect(trace.result.reason).toContain('Simulated database write failure');

      // CRITICAL INVARIANT (Blocker 1): The trace MUST NOT contain tour.materialization because persistence did not succeed!
      const materializationStep = trace.steps.find((s: any) => s.name === 'tour.materialization');
      expect(materializationStep).toBeUndefined();
    } finally {
      txSpy.mockRestore();
    }
  });
});
