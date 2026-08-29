import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { AiEmbeddingService } from '../src/shared/ai/services/ai-embedding.service';
import { PrismaService } from '../src/core/database/prisma.service';

// Exercises the real pgvector column, HNSW index, and raw-query path in
// VectorStoreService end-to-end against a real Postgres connection - the one
// layer unit tests (which mock PrismaService) can't verify. Only the
// embedding-generation network call is stubbed, since testing whether a
// third-party AI provider produces semantically good vectors is out of
// scope here; what this test verifies is that the ORDER BY embedding <=> ...
// query returns rows in the distance order pgvector computes.
describe('Activities similarity search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const activityIds: string[] = [];
  let existingEmbeddedCount = 0;

  const queryVector = [1, ...Array(255).fill(0)];
  const closeVector = [1, ...Array(255).fill(0)]; // identical -> distance 0
  const farVector = [0, 1, ...Array(254).fill(0)]; // orthogonal -> cosine distance 1

  const toVectorLiteral = (vector: number[]) => `[${vector.join(',')}]`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiEmbeddingService)
      .useValue({
        ensureInitialized: jest.fn().mockResolvedValue(undefined),
        getEmbeddings: () => ({
          embedQuery: jest.fn().mockResolvedValue(queryVector),
          embedDocuments: jest.fn(),
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const existingEmbeddingRows = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM "activity" WHERE "embedding" IS NOT NULL`;
    existingEmbeddedCount = Number(existingEmbeddingRows[0]?.count ?? 0);

    const target = await prisma.activity.create({
      data: { name: 'Target Activity', metadata: { tags: ['test'] } },
    });
    const near = await prisma.activity.create({
      data: { name: 'Near Activity', metadata: { tags: ['test'] } },
    });
    const far = await prisma.activity.create({
      data: { name: 'Far Activity', metadata: { tags: ['test'] } },
    });
    activityIds.push(target.id, near.id, far.id);

    await prisma.$executeRaw`
      UPDATE "activity" SET "embedding" = ${toVectorLiteral(closeVector)}::vector WHERE "id" = ${near.id}
    `;
    await prisma.$executeRaw`
      UPDATE "activity" SET "embedding" = ${toVectorLiteral(farVector)}::vector WHERE "id" = ${far.id}
    `;
  });

  afterAll(async () => {
    await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
    await app.close();
  });

  it('GET /activities/:id/similar orders results by pgvector distance', async () => {
    const [targetId, nearId, farId] = activityIds;

    const response = await request(app.getHttpServer())
      .get(`/activities/${targetId}/similar`)
      // This e2e may run against a developer database that already contains
      // embedded catalog rows. Request enough results to include the two
      // controlled fixtures; a fixed top-5 would legitimately omit the
      // orthogonal fixture and would not test ordering at all.
      .query({ limit: existingEmbeddedCount + 2 })
      .expect(200);

    const returnedIds = response.body.map((a: { id: string }) => a.id);
    expect(returnedIds).not.toContain(targetId);
    expect(returnedIds.indexOf(nearId)).toBeLessThan(
      returnedIds.indexOf(farId),
    );
  });
});
