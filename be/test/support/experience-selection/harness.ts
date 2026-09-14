import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/core/database/prisma.service';
import { OutboxPublisherService } from '../../../src/modules/outbox/services/outbox-publisher.service';
import { GeoapifyTravelEstimateProvider } from '../../../src/modules/tours/services/geoapify-travel-estimate.provider';
import { LangChainService } from '../../../src/shared/ai/langchain.service';
import { AiEmbeddingService } from '../../../src/shared/ai/services/ai-embedding.service';

import { assertDisposableDatabase } from '../assert-disposable-database';
import { resetTablesWith } from '../../integration/support/test-db';
import {
  FakeInterpretation,
  makeFakeCompetitiveEmbeddingService,
  makeFakeInterpreter,
  makeFakeRouting,
} from './fakes';

const RESET_TABLES_ALL = [
  'tour_experience_component',
  'tour_experience',
  'outbox_event',
  'tour',
  'experience_trait',
  'trait_definition',
  'experience_evidence',
  'experience_component',
  'geo_entity_identity',
  'geo_entity',
  'experience',
  'crawler_search',
  'email_login_code',
  'user',
];

const RESET_TABLES_TOURS = [
  'tour_experience_component',
  'tour_experience',
  'outbox_event',
  'tour',
];

export interface CompetitiveHarness {
  app: INestApplication;
  prisma: PrismaService;
  outboxPublisher: OutboxPublisherService;
  embeddingSpies: ReturnType<typeof makeFakeCompetitiveEmbeddingService>;
  setInterpretation: (next: FakeInterpretation) => void;
  authenticate: () => Promise<string>;
  generateTour: (
    token: string,
    generationRequest: Record<string, unknown>,
  ) => Promise<any>;
  truncateAll: () => Promise<void>;
  truncateToursOnly: () => Promise<void>;
  close: () => Promise<void>;
}

export async function bootstrapCompetitiveApp(): Promise<CompetitiveHarness> {
  process.env.NODE_ENV = 'test';
  process.env.ROUTING_PROVIDER = 'geoapify';

  const embeddingSpies = makeFakeCompetitiveEmbeddingService();
  const { fakeLangChain, setInterpretation } = makeFakeInterpreter();
  const fakeRouting = makeFakeRouting();

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(LangChainService)
    .useValue(fakeLangChain)
    .overrideProvider(AiEmbeddingService)
    .useValue(embeddingSpies.service)
    .overrideProvider(GeoapifyTravelEstimateProvider)
    .useValue(fakeRouting)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  const prisma = app.get(PrismaService);
  const outboxPublisher = app.get(OutboxPublisherService);

  const truncate = async (tables: string[]) => {
    assertDisposableDatabase();
    await resetTablesWith(prisma, tables);
  };

  const authenticate = async (): Promise<string> => {
    const email = 'experience-competitive-e2e@example.com';
    const codeResponse = await request(app.getHttpServer())
      .post('/auth/email/request-code')
      .send({ email })
      .expect(201);
    const authResponse = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ email, code: codeResponse.body.devCode })
      .expect(201);
    expect(authResponse.body.accessToken).toBeTruthy();
    return authResponse.body.accessToken;
  };

  const generateTour = async (
    token: string,
    generationRequest: Record<string, unknown>,
  ): Promise<any> => {
    const created = await request(app.getHttpServer())
      .post('/tours/generate-tour')
      .set('Authorization', `Bearer ${token}`)
      .send(generationRequest)
      .expect(201);
    const tourId = created.body.id;
    const event = await prisma.outboxEvent.findFirst({
      where: {
        eventType: 'TourGenerationRequested',
        payload: { path: ['tourId'], equals: tourId },
      },
    });
    expect(event?.status).toBe('PENDING');
    const publication = await outboxPublisher.processNextBatch();
    expect(publication.publishedCount).toBeGreaterThanOrEqual(1);
    const response = await request(app.getHttpServer())
      .get(`/tours/${tourId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.metadata.generationStatus).toBe('completed');
    return response.body;
  };

  return {
    app,
    prisma,
    outboxPublisher,
    embeddingSpies,
    setInterpretation,
    authenticate,
    generateTour,
    truncateAll: () => truncate(RESET_TABLES_ALL),
    truncateToursOnly: () => truncate(RESET_TABLES_TOURS),
    close: () => app.close(),
  };
}

export function traceStep(tour: any, stage: string): any {
  return (tour.metadata.generationTrace.steps ?? []).find(
    (step: any) => step.stage === stage,
  );
}
