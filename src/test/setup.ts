import { TEST_DATABASE_URL } from './db';

// Runs in the worker BEFORE the test file's imports are evaluated, which is the
// whole point: src/config.ts and src/db.ts validate and read DATABASE_URL at
// module load, so they must already point at the throwaway database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
