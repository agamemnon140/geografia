import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // A full Earth build takes a few seconds; several tests build more than one planet.
    testTimeout: 120000,
  },
});
