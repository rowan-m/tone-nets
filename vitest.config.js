import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/js/**/*.js'],
      exclude: ['src/js/**/*.test.js'],
    },
    include: ['src/js/**/*.test.js'],
  },
});
