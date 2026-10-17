// Stage 5 tests run against a throwaway database so they can never read or
// mutate the seeded `ecommerce` data you develop against. The URL is derived
// here (not read from .env) so a missing .env can never point tests at prod.
export const TEST_DATABASE_NAME = 'ecommerce_test';
export const TEST_DATABASE_URL = `postgresql://user:password@localhost:5432/${TEST_DATABASE_NAME}?schema=public`;
// Maintenance DB used only to DROP the test DB in teardown: you cannot drop a
// database while connected to it.
export const MAINTENANCE_DATABASE_URL = 'postgresql://user:password@localhost:5432/postgres?schema=public';
