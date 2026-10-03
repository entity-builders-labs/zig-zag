import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/core/database/prisma.service';
import { assertDisposableDatabase } from '../../support/assert-disposable-database';

/**
 * Loads a real DATABASE_URL for the integration suite. Prefers an explicit
 * env var (CI passes one for the `backend-integration` job); otherwise falls
 * back to the monorepo-root `.env` (local `docker-compose --profile dev up -d
 * postgres`). Never invents one.
 */
export function ensureEnvLoaded(): void {
  if (process.env.DATABASE_URL) return;
  for (const rel of ['../../../../.env', '../../../.env', '../../.env']) {
    const file = path.resolve(__dirname, rel);
    if (fs.existsSync(file)) dotenv.config({ path: file });
  }
}

function ensureDatabaseUrl(): string {
  ensureEnvLoaded();
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
    await prisma.$queryRaw(Prisma.sql`SELECT 1`);
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

/** Application tables, child-first so CASCADE order is deterministic. */
export const RESET_TABLES = [
  'tour_experience_component',
  'tour_experience',
  'tour',
  'outbox_event',
  'experience_trait',
  'experience_evidence',
  'experience_media',
  'experience_component',
  'experience',
  'geo_entity_identity',
  'geo_entity',
  'trait_definition',
  'crawler_search',
  'web_push_subscription',
  'user_device',
  'email_login_code',
  'user',
  'source',
  'overture_place_index',
  'overture_places_import_session',
];

export async function resetTablesWith(
  db: PrismaService,
  tables: readonly string[] = RESET_TABLES,
): Promise<void> {
  assertDisposableDatabase();
  if (tables.length === 0) return;
  if (tables.some((table) => !RESET_TABLES.includes(table))) {
    throw new Error('Refusing to reset a table outside the test allowlist.');
  }
  // Prisma's pg adapter rejects dynamic identifiers embedded in a tagged
  // `$executeRaw` statement even though the resulting SQL is valid. The table
  // names are safe here because they are restricted to RESET_TABLES above;
  // values are never interpolated into this statement.
  const tableList = tables.map((table) => `"${table}"`).join(', ');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Disposable test DB reset requires DATABASE_URL.');
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
  } finally {
    await pool.end();
  }
}

export async function resetDbWith(db: PrismaService): Promise<void> {
  await resetTablesWith(db);
}

export async function resetDb(): Promise<void> {
  assertDisposableDatabase();
  await resetDbWith(await getPrisma());
}

export async function closeDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
