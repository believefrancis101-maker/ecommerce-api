import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { MAINTENANCE_DATABASE_URL, TEST_DATABASE_NAME, TEST_DATABASE_URL } from './db';

// Runs a local npm binary (prisma/tsx) from the repo root with an explicit
// DATABASE_URL. process.env wins over .env, so the test DB is always the target.
const run = (command: string, env: NodeJS.ProcessEnv) =>
  execSync(command, { stdio: 'inherit', cwd: process.cwd(), env: { ...process.env, ...env } });

export default function globalSetup() {
  console.log(`\n[test] Preparing throwaway database "${TEST_DATABASE_NAME}"`);
  run('npx prisma migrate deploy', { DATABASE_URL: TEST_DATABASE_URL });
  run('npx tsx prisma/seed.ts', { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test' });

  return () => {
    // Teardown: drop the throwaway DB so a run leaves no state behind. FORCE is
    // Postgres 13+ and evicts lingering pools; failure is non-fatal because the
    // next run re-migrates and re-seeds an idempotent database anyway.
    assert.strictEqual(
      TEST_DATABASE_NAME,
      'ecommerce_test',
      'Test DB teardown refused: database name must be exactly "ecommerce_test"'
    );
    console.log(`[test] Dropping "${TEST_DATABASE_NAME}"`);
    try {
      execSync(`npx prisma db execute --url "${MAINTENANCE_DATABASE_URL}" --stdin`, {
        input: `DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}" WITH (FORCE);`,
        stdio: ['pipe', 'inherit', 'inherit'],
        cwd: process.cwd(),
        env: process.env,
      });
    } catch (error) {
      console.warn('[test] Could not drop test database (will be reused next run):', error);
    }
  };
}
