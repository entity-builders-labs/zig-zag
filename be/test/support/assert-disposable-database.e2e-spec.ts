import {
  assertDisposableDatabase,
  isDisposableDatabase,
} from './assert-disposable-database';

/**
 * Pure guard, no app/DB. Lives in the e2e project because the specs that
 * depend on it (`experience-selection-*.e2e-spec.ts`) run there.
 */
describe('assertDisposableDatabase', () => {
  const originalOptIn = process.env.ALLOW_DESTRUCTIVE_TEST_DB;
  afterEach(() => {
    if (originalOptIn === undefined)
      delete process.env.ALLOW_DESTRUCTIVE_TEST_DB;
    else process.env.ALLOW_DESTRUCTIVE_TEST_DB = originalOptIn;
  });

  const url = (db: string) =>
    `postgresql://postgres:postgres@localhost:5432/${db}`;

  it.each([
    'zigzag_test',
    'zigzag_integration',
    'zigzag_e2e',
    'zigzag-test',
    'app_ci',
    'something_integration',
  ])('accepts the disposable name %s', (db) => {
    delete process.env.ALLOW_DESTRUCTIVE_TEST_DB;
    expect(isDisposableDatabase(url(db))).toBe(true);
    expect(() => assertDisposableDatabase(url(db))).not.toThrow();
  });

  it.each([
    'zigzag',
    'postgres',
    'zigzag_prod',
    'zigzag_production',
    'main',
    '',
  ])('rejects the non-disposable name %s', (db) => {
    delete process.env.ALLOW_DESTRUCTIVE_TEST_DB;
    expect(isDisposableDatabase(url(db))).toBe(false);
    expect(() => assertDisposableDatabase(url(db))).toThrow(
      /not provably disposable/,
    );
  });

  it('rejects an empty / unparseable URL', () => {
    delete process.env.ALLOW_DESTRUCTIVE_TEST_DB;
    // '' is falsy so it is NOT replaced by the process.env.DATABASE_URL default.
    expect(isDisposableDatabase('')).toBe(false);
    expect(isDisposableDatabase('not a url')).toBe(false);
    expect(() => assertDisposableDatabase('not a url')).toThrow();
  });

  it('ALLOW_DESTRUCTIVE_TEST_DB=1 overrides any rejection', () => {
    process.env.ALLOW_DESTRUCTIVE_TEST_DB = '1';
    expect(isDisposableDatabase(url('zigzag'))).toBe(true);
    expect(() => assertDisposableDatabase(url('zigzag'))).not.toThrow();
  });

  it('never leaks credentials in the error message', () => {
    delete process.env.ALLOW_DESTRUCTIVE_TEST_DB;
    let message = '';
    try {
      assertDisposableDatabase(
        'postgresql://user:s3cret@db.example:5432/zigzag',
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('db.example:5432/zigzag');
    expect(message).not.toContain('s3cret');
    expect(message).not.toContain('user:');
  });
});
