import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/core/database/prisma.service';
import { closeDb, getPrisma, resetDb } from './support/test-db';
import { assertDisposableDatabase } from '../support/assert-disposable-database';

describe('disposable test database reset contract', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    assertDisposableDatabase();
    prisma = await getPrisma();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('resets twice while preserving PostGIS, pgvector, and migrated schema use', async () => {
    await resetDb();
    const firstGeo = await prisma.geoEntity.create({
      data: { name: 'reset regression place', kind: 'PLACE' },
    });
    await prisma.experience.create({
      data: {
        canonicalName: 'reset regression experience',
        status: 'VERIFIED',
        components: {
          create: { geoEntityId: firstGeo.id, role: 'venue' },
        },
      },
    });
    expect(await prisma.experience.count()).toBe(1);
    expect(await prisma.geoEntity.count()).toBe(1);

    await resetDb();
    expect(await prisma.experience.count()).toBe(0);
    expect(await prisma.geoEntity.count()).toBe(0);

    const extensions = await prisma.$queryRaw<Array<{ extname: string }>>(
      Prisma.sql`SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector') ORDER BY extname`,
    );
    expect(extensions.map(({ extname }) => extname)).toEqual([
      'postgis',
      'vector',
    ]);
    const spatial = await prisma.$queryRaw<Array<{ ok: boolean }>>(
      Prisma.sql`SELECT ST_DWithin(ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 1) AS ok`,
    );
    expect(spatial[0]?.ok).toBe(true);
    const vector = await prisma.$queryRaw<Array<{ dimensions: number }>>(
      Prisma.sql`SELECT vector_dims('[1,2,3]'::vector) AS dimensions`,
    );
    expect(Number(vector[0]?.dimensions)).toBe(3);

    const secondGeo = await prisma.geoEntity.create({
      data: { name: 'reset regression place 2', kind: 'PLACE' },
    });
    await prisma.experience.create({
      data: {
        canonicalName: 'reset regression experience 2',
        status: 'VERIFIED',
        components: {
          create: { geoEntityId: secondGeo.id, role: 'venue' },
        },
      },
    });
    expect(await prisma.experience.count()).toBe(1);
  });
});
