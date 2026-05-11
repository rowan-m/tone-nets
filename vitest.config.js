import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      reportOnFailure: true,
      include: ['src/js/**/*.js'],
      exclude: ['src/js/**/*.test.js'],
    },
    include: ['src/js/**/*.test.js'],
  },
});
