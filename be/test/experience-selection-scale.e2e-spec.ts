import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ExperienceStatus, GeoEntityKind, MediaStatus } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { OutboxPublisherService } from '../src/modules/outbox/services/outbox-publisher.service';
import { GeoapifyTravelEstimateProvider } from '../src/modules/tours/services/geoapify-travel-estimate.provider';
import { TransportationMode } from '../src/modules/tours/interfaces/tour-generation.interface';
import { LangChainService } from '../src/shared/ai/langchain.service';
import { AiEmbeddingService } from '../src/shared/ai/services/ai-embedding.service';

jest.setTimeout(90_000);

const EMBEDDING_DIMENSIONS = 256;
const EMBEDDING_IDENTITY = {
  provider: 'e2e',
  model: 'deterministic-scale-v1',
  dimensions: EMBEDDING_DIMENSIONS,
  documentVersion: 2,
};

const positiveVector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1);
const negativeVector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => -1);

interface SeededExperience {
  id: string;
  oracleClass:
    | 'ideal'
    | 'religious_false_friend'
    | 'tango_only'
    | 'accessible_only'
    | 'distractor';
}

function preferenceInterpretationResponse() {
  return JSON.stringify({
    preferredThemes: ['tango'],
    preferredTraits: [],
    preferredIntents: [],
    excludedThemes: ['religion'],
    excludedTraits: [],
    hardExclusions: ['religion'],
    softConstraints: [],
    ambiguities: [],
    dietaryPreferences: [],
    accessibilityPreferences: ['accessibility'],
    budgetPreferences: [],
    groupPreferences: [],
    positiveSemanticQuery: 'tango accesible',
    notes: ['e2e normalized intent'],
  });
}

function buildSeed(index: number): SeededExperience {
  if (index % 13 === 0) {
    return {
      id: `scale-ideal-${String(index).padStart(3, '0')}`,
      oracleClass: 'ideal',
    };
  }
  if (index % 17 === 0) {
    return {
      id: `scale-religious-${String(index).padStart(3, '0')}`,
      oracleClass: 'religious_false_friend',
    };
  }
  if (index % 5 === 0) {
    return {
      id: `scale-tango-${String(index).padStart(3, '0')}`,
      oracleClass: 'tango_only',
    };
  }
  if (index % 7 === 0) {
    return {
      id: `scale-accessible-${String(index).padStart(3, '0')}`,
      oracleClass: 'accessible_only',
    };
  }
  return {
    id: `scale-distractor-${String(index).padStart(3, '0')}`,
    oracleClass: 'distractor',
  };
}

function metadataFor(seed: SeededExperience) {
  switch (seed.oracleClass) {
    case 'ideal':
      return {
        themes: ['tango'],
        traits: ['accessibility', 'live music'],
        intents: ['performance'],
        oracleClass: seed.oracleClass,
      };
    case 'religious_false_friend':
      return {
        themes: ['tango', 'religion'],
        traits: ['accessibility'],
        intents: ['performance'],
        oracleClass: seed.oracleClass,
      };
    case 'tango_only':
      return {
        themes: ['tango'],
        traits: ['nightlife'],
        intents: ['performance'],
        oracleClass: seed.oracleClass,
      };
    case 'accessible_only':
      return {
        themes: ['culture'],
        traits: ['accessibility'],
        intents: ['visit'],
        oracleClass: seed.oracleClass,
      };
    default: {
      const distractorThemes = ['shopping', 'sports', 'architecture'];
      return {
        themes: [
          distractorThemes[Number(seed.id.slice(-1)) % distractorThemes.length],
        ],
        traits: ['general'],
        intents: ['visit'],
        oracleClass: seed.oracleClass,
      };
    }
  }
}

describe('Experience V2 selection at scale (public API + PostgreSQL + outbox)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outboxPublisher: OutboxPublisherService;
  const seeded = Array.from({ length: 320 }, (_, index) => buildSeed(index));
  const idealIds = new Set(
    seeded
      .filter((item) => item.oracleClass === 'ideal')
      .map((item) => item.id),
  );

  const fakeLangChain = {
    generateChatResponse: jest.fn(async () =>
      preferenceInterpretationResponse(),
    ),
    getProviderMetadata: jest.fn(() => ({
      provider: 'e2e-preference-interpreter',
      model: 'deterministic-json-v1',
    })),
  };

  const fakeEmbeddings = {
    embedQuery: jest.fn(async () => [...positiveVector]),
    embedDocuments: jest.fn(
      async (texts: string[]): Promise<number[][]> =>
        texts.map(() => [...positiveVector]),
    ),
  };

  const fakeEmbeddingService = {
    ensureInitialized: jest.fn(async (): Promise<void> => undefined),
    getIndexIdentity: jest.fn(() => EMBEDDING_IDENTITY),
    getStatus: jest.fn(() => ({
      status: 'ready',
      identity: EMBEDDING_IDENTITY,
    })),
    getEmbeddings: jest.fn(() => fakeEmbeddings),
  };

  const fakeGeoapifyRouting = {
    isAvailable: jest.fn(() => true),
    estimate: jest.fn(
      async (from: any, to: any, allowedModes: TransportationMode[]) => {
        const dLat = to.centroid.lat - from.centroid.lat;
        const dLng = to.centroid.lng - from.centroid.lng;
        const distanceMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111_000;
        const mode = allowedModes.includes(TransportationMode.WALKING)
          ? TransportationMode.WALKING
          : allowedModes[0];
        const durationMinutes = (distanceMeters / 1000 / 4.8) * 60;
        return {
          mode,
          durationMinutes,
          distanceMeters,
          walkingMinutes:
            mode === TransportationMode.WALKING ? durationMinutes : 0,
          walkingDistanceMeters:
            mode === TransportationMode.WALKING ? distanceMeters : 0,
          approximate: false,
          provider: 'geoapify',
        };
      },
    ),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ROUTING_PROVIDER = 'geoapify';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LangChainService)
      .useValue(fakeLangChain)
      .overrideProvider(AiEmbeddingService)
      .useValue(fakeEmbeddingService)
      .overrideProvider(GeoapifyTravelEstimateProvider)
      .useValue(fakeGeoapifyRouting)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    outboxPublisher = app.get(OutboxPublisherService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "tour_experience_component",
        "tour_experience",
        "outbox_event",
        "tour",
        "experience_trait",
        "trait_definition",
        "experience_evidence",
        "experience_component",
        "geo_entity_identity",
        "geo_entity",
        "experience",
        "crawler_search",
        "email_login_code",
        "user"
      RESTART IDENTITY CASCADE
    `);

    const geoRows = seeded.map((seed, index) => ({
      id: `geo-${seed.id}`,
      name:
        seed.oracleClass === 'religious_false_friend'
          ? `Catedral Tango ${index}`
          : `Venue ${seed.id}`,
      kind: GeoEntityKind.PLACE,
      latitude: -34.6037 + (index % 20) * 0.00025,
      longitude: -58.3816 + Math.floor(index / 20) * 0.00025,
      address: `E2E ${index}, Buenos Aires`,
      metadata: { oracleClass: seed.oracleClass },
    }));
    await prisma.geoEntity.createMany({ data: geoRows });

    await prisma.experience.createMany({
      data: seeded.map((seed, index) => ({
        id: seed.id,
        canonicalName:
          seed.oracleClass === 'ideal'
            ? `Tango accesible ${index}`
            : seed.oracleClass === 'religious_false_friend'
              ? `Tango accesible en Catedral ${index}`
              : seed.oracleClass === 'tango_only'
                ? `Milonga tradicional ${index}`
                : seed.oracleClass === 'accessible_only'
                  ? `Museo accesible ${index}`
                  : `Distractor ${index}`,
        description:
          seed.oracleClass === 'ideal'
            ? 'Experiencia de tango y música en vivo con acceso step-free y espacios accesibles.'
            : seed.oracleClass === 'religious_false_friend'
              ? 'Tango accesible dentro de una iglesia y catedral histórica.'
              : seed.oracleClass === 'tango_only'
                ? 'Tango y milonga tradicional con escaleras y sin información de accesibilidad.'
                : seed.oracleClass === 'accessible_only'
                  ? 'Visita cultural accesible, sin tango ni música en vivo.'
                  : 'Actividad general sin relación con tango ni accesibilidad.',
        durationMinutes: 60,
        price: seed.oracleClass === 'ideal' ? 20 : 15 + (index % 10),
        status: ExperienceStatus.VERIFIED,
        qualityScore:
          seed.oracleClass === 'ideal' ? 4.0 : 3.0 + (index % 20) / 10,
        latitude: geoRows[index].latitude,
        longitude: geoRows[index].longitude,
        metadata: metadataFor(seed),
        mediaStatus: MediaStatus.ENRICHED,
        mediaUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
        embeddingProvider: EMBEDDING_IDENTITY.provider,
        embeddingModel: EMBEDDING_IDENTITY.model,
        embeddingDimensions: EMBEDDING_IDENTITY.dimensions,
        embeddingDocumentVersion: EMBEDDING_IDENTITY.documentVersion,
        embeddedAt: new Date('2026-09-01T00:00:00.000Z'),
      })),
    });

    await prisma.experienceComponent.createMany({
      data: seeded.map((seed, index) => ({
        experienceId: seed.id,
        geoEntityId: geoRows[index].id,
        order: 1,
        role: 'venue',
        required: true,
      })),
    });

    const idealVectorLiteral = `[${positiveVector.join(',')}]`;
    const distractorVectorLiteral = `[${negativeVector.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${idealVectorLiteral}'::vector WHERE "id" LIKE 'scale-ideal-%'`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "experience" SET "embedding" = '${distractorVectorLiteral}'::vector WHERE "id" NOT LIKE 'scale-ideal-%'`,
    );
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function authenticate(): Promise<string> {
    const email = 'experience-scale-e2e@example.com';
    const codeResponse = await request(app.getHttpServer())
      .post('/auth/email/request-code')
      .send({ email })
      .expect(201);
    expect(codeResponse.body.devCode).toMatch(/^\d{6}$/);

    const authResponse = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ email, code: codeResponse.body.devCode })
      .expect(201);
    expect(authResponse.body.accessToken).toBeTruthy();
    return authResponse.body.accessToken;
  }

  it('selects only the independently-defined best-fit Experiences from 320 persisted rows', async () => {
    expect(seeded).toHaveLength(320);
    expect(idealIds.size).toBeGreaterThanOrEqual(20);

    const accessToken = await authenticate();
    const generationRequest: any = {
      destination: {
        label: 'Obelisco, Buenos Aires',
        latitude: -34.6037,
        longitude: -58.3816,
        radiusMeters: 5000,
        scaleHint: 'specific_point',
      },
      days: 2,
      budgetLevel: 'medium',
      groupType: 'friends',
      intent: {
        interests: ['tango'],
        explorationStyle: 'balanced',
        additionalPreferences:
          'Quiero tango accesible y música en vivo. No quiero iglesias ni experiencias religiosas.',
      },
      mobility: {
        allowedTransportationModes: ['walking'],
        maxWalkingDistancePerDayMeters: 12000,
        maxContinuousWalkingDistanceMeters: 3000,
        travelPace: 'moderate',
        accessibilityNeeds: ['accessibility'],
      },
      dietaryRestrictions: [],
      startDates: ['2026-09-07'],
      includeExistingExperiences: true,
      skipImageGeneration: true,
      excludeTours: [],
      categories: [],
    };

    const createResponse = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(generationRequest)
      .expect(201);

    const tourId = createResponse.body.id;
    expect(tourId).toBeTruthy();

    const pendingGeneration = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'TourGenerationRequested',
        payload: { path: ['tourId'], equals: tourId },
      },
    });
    expect(pendingGeneration).toBeTruthy();
    expect(pendingGeneration?.status).toBe('PENDING');

    const publication = await outboxPublisher.processNextBatch();
    expect(publication.claimedCount).toBeGreaterThanOrEqual(1);
    expect(publication.publishedCount).toBeGreaterThanOrEqual(1);

    const tourResponse = await request(app.getHttpServer())
      .get(`/tours/${tourId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const tour = tourResponse.body;
    expect(tour.metadata.generationStatus).toBe('completed');
    expect(tour.experiences.length).toBeGreaterThanOrEqual(8);
    expect(tour.experiences.length).toBeLessThanOrEqual(15);

    const selectedIds = tour.experiences.map((item: any) => item.experienceId);
    expect(new Set(selectedIds).size).toBe(selectedIds.length);
    expect(selectedIds.every((id: string) => idealIds.has(id))).toBe(true);

    for (const item of tour.experiences) {
      expect(item.experience.metadata.oracleClass).toBe('ideal');
      expect(item.components).toHaveLength(1);
      expect(item.components[0].geoEntityId).toBeTruthy();
      expect(item.components[0].name).toContain('Venue scale-ideal-');
    }

    expect(tour.metadata.generationTrace.version).toBe(3);
    expect(tour.metadata.generationTrace.canonicalRequest).toMatchObject({
      destination: { label: 'Obelisco, Buenos Aires' },
      days: 2,
      intent: { interests: ['tango'] },
    });
    expect(
      tour.metadata.generationTrace.materializedTourExperiences,
    ).toHaveLength(tour.experiences.length);
    const traceSteps = tour.metadata.generationTrace.steps;
    const preferenceTrace = traceSteps.find(
      (step: any) => step.stage === 'preference_interpretation',
    );
    expect(preferenceTrace.preferenceInterpretation.provider).toBe(
      'e2e-preference-interpreter',
    );
    expect(preferenceTrace.preferenceInterpretation.rawResponse).toContain(
      'hardExclusions',
    );

    const coverageTrace = traceSteps.find(
      (step: any) => step.stage === 'coverage_analysis',
    );
    expect(
      coverageTrace.coverageReport.analyzedCandidateCount,
    ).toBeGreaterThanOrEqual(250);
    expect(coverageTrace.coverageReport.status).toBe('sufficient');
    expect(coverageTrace.coverageReport.decision.action).toBe('none');

    const candidatePoolTrace = traceSteps.find(
      (step: any) => step.stage === 'candidate_pool',
    );
    expect(candidatePoolTrace.candidates).toHaveLength(15);
    expect(
      candidatePoolTrace.candidates.every((candidate: any) =>
        idealIds.has(candidate.id),
      ),
    ).toBe(true);
    expect(
      candidatePoolTrace.candidates.every(
        (candidate: any) => candidate.scoreBreakdown.semanticSimilarity > 0.99,
      ),
    ).toBe(true);

    expect(traceSteps.some((step: any) => step.stage === 'discovery')).toBe(
      false,
    );
    expect(tour.metadata.executionSummary.status).toBe('completed');
    expect(tour.metadata.executionSummary.selectedExperiences).toBe(
      tour.experiences.length,
    );
    expect(tour.metadata.executionSummary.orderedStages.at(-1)).toMatchObject({
      stage: 'tour_experience_materialization',
      outcome: 'TOUR_EXPERIENCES_PERSISTED',
    });
    const planningTrace = traceSteps.find(
      (step: any) => step.stage === 'daily_planning',
    );
    expect(
      planningTrace.dailyPlanning.routing.providerCounts.geoapify,
    ).toBeGreaterThan(0);
    expect(
      planningTrace.dailyPlanning.routing.externalEstimateCount,
    ).toBeGreaterThan(0);

    const storedGenerationEvent = await prisma.outboxEvent.findUnique({
      where: { id: pendingGeneration!.id },
    });
    expect(storedGenerationEvent?.status).toBe('PUBLISHED');

    const secondCreate = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(generationRequest)
      .expect(201);
    const secondTourId = secondCreate.body.id;
    expect(secondTourId).not.toBe(tourId);

    const secondGenerationEvent = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'TourGenerationRequested',
        payload: { path: ['tourId'], equals: secondTourId },
      },
    });
    expect(secondGenerationEvent).toBeTruthy();
    await outboxPublisher.processNextBatch();

    const secondTourResponse = await request(app.getHttpServer())
      .get(`/tours/${secondTourId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const secondTour = secondTourResponse.body;
    expect(secondTour.metadata.generationStatus).toBe('completed');

    const normalizePlan = (value: any) =>
      value.experiences.map((item: any) => ({
        experienceId: item.experienceId,
        dayNumber: item.dayNumber,
        order: item.order,
        startTime: item.startTime,
        duration: item.duration,
        components: item.components.map((component: any) => ({
          geoEntityId: component.geoEntityId,
          order: component.order,
          role: component.role,
          required: component.required,
        })),
      }));
    expect(normalizePlan(secondTour)).toEqual(normalizePlan(tour));
    expect(secondTour.metadata.generationTrace.version).toBe(3);
  });
});
