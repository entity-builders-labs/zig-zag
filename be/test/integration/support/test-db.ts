import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/core/database/prisma.service';

/**
 * Loads a real DATABASE_URL for the integration suite. Prefers an explicit
 * env var (CI passes one for the `backend-integration` job); otherwise falls
 * back to the monorepo-root `.env` (local `docker-compose --profile dev up -d
 * postgres`). Never invents one.
 */
function ensureDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const rel of ['../../../../.env', '../../../.env']) {
    const file = path.resolve(__dirname, rel);
    if (fs.existsSync(file)) dotenv.config({ path: file });
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'test:integration needs a reachable Postgres. Set DATABASE_URL or run ' +
        '`docker-compose --profile dev up -d postgres`.',
    );
  }
  return process.env.DATABASE_URL;
}

let prisma: PrismaService | undefined;

export async function getPrisma(): Promise<PrismaService> {
  if (prisma) return prisma;
  const url = ensureDatabaseUrl();
  const config = {
    get: (key: string) =>
      key === 'database.url'
        ? url
        : key === 'database.directUrl'
          ? (process.env.DIRECT_URL ?? url)
          : undefined,
  } as unknown as ConfigService;
  prisma = new PrismaService(config);
  try {
    await prisma.$connect();
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (error) {
    throw new Error(
      `test:integration could not connect to Postgres at ${url.replace(
        /:[^:@/]+@/,
        ':***@',
      )}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return prisma;
}

/** Tables touched by tour generation, child-first so CASCADE order is safe. */
const RESET_TABLES = [
  'tour_experience_component',
  'tour_experience',
  'tour',
  'experience_trait',
  'experience_evidence',
  'experience_media',
  'experience_component',
  'experience',
  'geo_entity_identity',
  'geo_entity',
  'trait_definition',
  'crawler_search',
];

export async function resetDb(): Promise<void> {
  const db = await getPrisma();
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${RESET_TABLES.map((t) => `"${t}"`).join(
      ', ',
    )} RESTART IDENTITY CASCADE`,
  );
}

export async function closeDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
