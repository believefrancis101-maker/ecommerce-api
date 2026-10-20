import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // global-setup builds + seeds the throwaway DB once; setup.ts points each
    // worker's env at it before app/config modules load.
    globalSetup: './src/test/global-setup.ts',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 15000,
    // Every file shares ONE throwaway database, so files must run one at a
    // time: parallel workers would interleave writes and read each other's rows.
    fileParallelism: false,
  },
});
