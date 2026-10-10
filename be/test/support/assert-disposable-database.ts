/**
 * Fail-closed guard for destructive test setup.
 *
 * Several E2E specs run `TRUNCATE ... RESTART IDENTITY CASCADE` over the whole
 * database `DATABASE_URL` points at. Locally that has more than once been the
 * shared `zigzag` dev database. Call this immediately before any such TRUNCATE:
 * it throws unless the target database is provably disposable.
 *
 * A database is accepted iff ONE of:
 *   - `ALLOW_DESTRUCTIVE_TEST_DB=1` is set explicitly (the CI opt-in — the
 *     ephemeral service DB is named `zigzag` but is genuinely throwaway);
 *   - the database name ends in `_test` / `-test` / `_integration` / `_e2e` /
 *     `_ci` (case-insensitive).
 *
 * Everything else — `zigzag`, `zigzag_prod`, `postgres`, any prod-like name, an
 * unparseable or missing URL — is rejected. Error messages carry only a
 * redacted `host/db`, never credentials or the full URL.
 *
 * This is a minimal footgun guard, NOT the full test-DB hardening tracked in
 * docs/superpowers/plans/2026-09-09-database-pool-hardening-and-observability.md
 * (§15-16, increment D). It deliberately does not touch
 * be/test/integration/support/test-db.ts.
 */

const DISPOSABLE_SUFFIX = /(?:^|[_-])(test|integration|e2e|ci)$/i;
const DOCUMENTED_SPIKE_DATABASE = 'zigzag_spike_preb6';

function parseTarget(databaseUrl: string | undefined): {
  host: string;
  database: string;
} {
  if (!databaseUrl || typeof databaseUrl !== 'string') {
    return { host: 'unknown', database: '' };
  }
  try {
    const url = new URL(databaseUrl);
    const database = decodeURIComponent(
      url.pathname.replace(/^\//, '').split('/')[0] ?? '',
    );
    return { host: `${url.hostname}:${url.port || '5432'}`, database };
  } catch {
    return { host: 'unparseable', database: '' };
  }
}

export function isDisposableDatabase(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): boolean {
  if (process.env.ALLOW_DESTRUCTIVE_TEST_DB === '1') {
    return true;
  }
  const { database } = parseTarget(databaseUrl);
  if (!database || database.toLowerCase() === 'zigzag') {
    return false;
  }
  return (
    DISPOSABLE_SUFFIX.test(database) ||
    database.toLowerCase() === DOCUMENTED_SPIKE_DATABASE
  );
}

export function assertDisposableDatabase(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): void {
  if (isDisposableDatabase(databaseUrl)) {
    return;
  }
  const { host, database } = parseTarget(databaseUrl);
  throw new Error(
    `Refusing to TRUNCATE a database that is not provably disposable ` +
      `(${host}/${database || '<none>'}). Point DATABASE_URL at a dedicated ` +
      `test database (e.g. zigzag_test) or set ALLOW_DESTRUCTIVE_TEST_DB=1.`,
  );
}
