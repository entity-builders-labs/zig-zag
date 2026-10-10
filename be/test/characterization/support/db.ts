import { PrismaService } from 'src/core/database/prisma.service';
import { assertDisposableDatabase } from '../../support/assert-disposable-database';
import {
  ensureEnvLoaded,
  getPrisma,
  resetDbWith,
} from '../../integration/support/test-db';

export { closeDb } from '../../integration/support/test-db';

/**
 * Guarded Postgres accessor for the characterization suite.
 *
 * The characterization DB specs run `TRUNCATE ... RESTART IDENTITY CASCADE`
 * over whatever `DATABASE_URL` points at. This wrapper fails closed BEFORE any
 * connection or destructive SQL if that database is not provably disposable
 * (see be/test/support/assert-disposable-database.ts) — e.g. a plain dev
 * `zigzag`. The opt-in `ALLOW_DESTRUCTIVE_TEST_DB=1` is honoured (CI's
 * ephemeral service DB is named `zigzag` but is genuinely throwaway).
 */
export async function getGuardedCharacterizationPrisma(): Promise<PrismaService> {
  ensureEnvLoaded();
  assertDisposableDatabase(process.env.DATABASE_URL);
  return getPrisma();
}

/**
 * `resetDbWith` with the disposable-database guard re-checked immediately
 * before the TRUNCATE — defence in depth, so a spec that resets mid-run can
 * never truncate a non-disposable database even if it skipped the accessor.
 */
export async function resetCharacterizationDb(
  db: PrismaService,
): Promise<void> {
  assertDisposableDatabase(process.env.DATABASE_URL);
  await resetDbWith(db);
}
