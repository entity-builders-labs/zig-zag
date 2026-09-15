import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/core/database/prisma.service';
import { ExperienceGenerationService } from 'src/modules/tours/services/experience-generation.service';
import { loadRootEnv } from './discovery/discovery-live.helper';
import { resetDbWith } from '../integration/support/test-db';
import { seedTour } from '../integration/support/seed';

loadRootEnv();
jest.setTimeout(30 * 60 * 1000);

const RUN = process.env.RUN_PREFERENCE_FIRST_LIVE_GATE === '1';
const SPIKE_DATABASE = 'zigzag_spike_preb6';

function requireDedicatedSpikeDatabase(): string {
  const value =
    process.env.PREFERENCE_FIRST_LIVE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      `Set PREFERENCE_FIRST_LIVE_DATABASE_URL to the dedicated ${SPIKE_DATABASE} database.`,
    );
  }
  const database = new URL(value).pathname.replace(/^\//, '');
  if (
    !['localhost', '127.0.0.1'].includes(new URL(value).hostname) ||
    database !== SPIKE_DATABASE
  ) {
    throw new Error(
      `Formal preference-first live gate refuses non-dedicated database ${database}.`,
    );
  }
  return value;
}

function traceSteps(tour: { metadata: unknown }): any[] {
  return ((tour.metadata as any)?.generationTrace?.steps ?? []) as any[];
}

function traceSnapshot(tour: { metadata: unknown }): Record<string, unknown> {
  const metadata = tour.metadata as any;
  return {
    generationStatus: metadata?.generationStatus,
    generationMessage: metadata?.generationMessage,
    // The production persistence boundary already redacts and bounds this
    // object. Preserve it exactly instead of maintaining a second snapshot
    // contract in the live spec.
    generationTrace: metadata?.generationTrace,
  };
}

function hasFacet(spec: any, dimension: string, key: string): boolean {
  return (spec?.facets ?? []).some(
    (facet: any) => facet.dimension === dimension && facet.key === key,
  );
}

(RUN ? describe : describe.skip)(
  'LIVE formal preference-first Buenos Aires gate (P8A, not RW1)',
  () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let generation: ExperienceGenerationService;
    let activeTourId: string | undefined;

    beforeAll(async () => {
      const databaseUrl = requireDedicatedSpikeDatabase();
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = databaseUrl;
      process.env.DIRECT_URL = databaseUrl;
      moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      prisma = moduleRef.get(PrismaService);
      generation = moduleRef.get(ExperienceGenerationService);
      await prisma.$connect();
      await resetDbWith(prisma);
    });

    afterEach(async () => {
      if (!prisma || !activeTourId) return;
      const tour = await prisma.tour.findUnique({
        where: { id: activeTourId },
      });
      if (!tour) return;
      const artifactPath = join(
        tmpdir(),
        `preference-first-m9-last-trace-${activeTourId}.json`,
      );
      writeFileSync(artifactPath, JSON.stringify(traceSnapshot(tour), null, 2));
      console.info(`M9 trace artifact: ${artifactPath}`);
      activeTourId = undefined;
    });

    afterAll(async () => {
      if (prisma) await resetDbWith(prisma);
      await moduleRef?.close();
    });

    it('runs the canonical two-day request and proves the P8A trace contract', async () => {
      const tourId = await seedTour(prisma, {
        destinationLabel: 'Buenos Aires, Argentina',
        latitude: -34.6037,
        longitude: -58.3816,
        radiusMeters: 20_000,
        days: 2,
        interests: [],
        intents: ['walk'],
        additionalPreferences:
          'sí o sí quiero una caminata histórica por San Telmo',
        maxContinuousWalkingDistanceMeters: 3000,
      });
      activeTourId = tourId;

      let generationError: unknown;
      try {
        await generation.generateTourExperiences(tourId);
      } catch (error) {
        generationError = error;
      }

      if (generationError) {
        const failedTour = await prisma.tour.findUniqueOrThrow({
          where: { id: tourId },
        });
        const snapshot = traceSnapshot(failedTour);
        const artifactPath = join(
          tmpdir(),
          `preference-first-m9-failure-${tourId}.json`,
        );
        writeFileSync(artifactPath, JSON.stringify(snapshot, null, 2));
        const failureTrace = snapshot.generationTrace as any;
        expect(failureTrace?.version).toBe(4);
        expect((failureTrace?.steps as unknown[]).length).toBeGreaterThan(0);
        expect(failureTrace?.executionSummary?.status).toBe('failed');
        throw new Error(
          `M9 generation failed after persisted trace validation. ` +
            `cause=${generationError instanceof Error ? generationError.message : String(generationError)} ` +
            `stages=${(failureTrace.steps as any[]).map((step) => `${step.stage}:${step.status ?? 'n/a'}`).join(',')} ` +
            `traceArtifact=${artifactPath}`,
        );
      }

      const tour = await prisma.tour.findUniqueOrThrow({
        where: { id: tourId },
      });
      const steps = traceSteps(tour);
      const preferenceStep = steps.find(
        (step) => step.stage === 'preference_interpretation',
      );
      const destinationStep = steps.find(
        (step) => step.stage === 'destination_resolution',
      );
      const coverageSteps = steps.filter(
        (step) => step.stage === 'coverage_analysis',
      );
      const planningStep = steps.find(
        (step) => step.stage === 'daily_planning',
      );
      const trace = (tour.metadata as any).generationTrace;
      const preferenceSpec = preferenceStep?.outputs?.preferenceSpec;

      expect((tour.metadata as any).generationStatus).toMatch(
        /finalizing|completed|generating/,
      );
      expect(trace.version).toBe(4);
      expect(preferenceStep?.preferenceInterpretation?.status).toBe('applied');
      expect(preferenceSpec?.explorationStyle).toBe('balanced');
      expect(
        preferenceSpec?.facets?.some(
          (facet: any) => facet.dimension === 'exploration_style',
        ),
      ).toBe(false);
      expect(hasFacet(preferenceSpec, 'intent', 'walk')).toBe(true);
      expect(
        (preferenceSpec?.anchors ?? []).some(
          (anchor: any) =>
            anchor.rawName.toLowerCase() === 'san telmo' &&
            anchor.kind === 'area' &&
            anchor.priority === 'must',
        ),
      ).toBe(true);
      expect(destinationStep?.outputs?.scale).toBe('area');
      expect(coverageSteps.length).toBeGreaterThan(0);
      expect(planningStep?.dailyPlanning?.dayCount).toBe(2);
      expect(steps.some((step) => step.semanticRanking)).toBe(true);

      const scheduled = await prisma.tourExperience.findMany({
        where: { tourId },
        include: {
          experience: {
            include: {
              components: {
                include: { geoEntity: { include: { identities: true } } },
              },
            },
          },
        },
      });
      expect(scheduled.length).toBeGreaterThan(0);
      expect(
        scheduled.every(
          (item) =>
            item.experience.components.length > 0 &&
            item.experience.components.every((component) =>
              component.geoEntity.identities.every(
                (identity) => identity.externalId !== '0',
              ),
            ),
        ),
      ).toBe(true);

      const persistedClassifications = await prisma.experience.findMany({
        where: { id: { in: scheduled.map((item) => item.experienceId) } },
        select: { metadata: true },
      });
      expect(
        persistedClassifications.every((row) => {
          const classification = (row.metadata as any)?.classification;
          return (
            classification?.state === 'classified' &&
            Array.isArray(classification.reasoningEvidence)
          );
        }),
      ).toBe(true);

      const composedWalk = await prisma.experience.findFirst({
        where: {
          status: 'VERIFIED',
          components: { some: {} },
          metadata: { path: ['intents'], array_contains: ['walk'] },
        },
        include: { components: true },
      });
      expect(composedWalk?.components.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(
        (planningStep?.outputs?.residualCapacity ??
          (tour.metadata as any)?.generationTrace?.residualCapacity) !==
          undefined,
      ).toBe(true);
    });
  },
);
