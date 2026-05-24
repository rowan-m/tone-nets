import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        reporters: process.env.GITHUB_ACTIONS
            ? ['default', 'github-actions', 'junit']
            : ['default'],
        outputFile: {
            junit: './junit.xml',
        },
        coverage: {
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'json', 'json-summary', 'html'],
            reportsDirectory: './coverage',
            reportOnFailure: true,
            include: ['src/js/**/*.js'],
            exclude: ['src/js/**/*.test.js'],
            thresholds: {
                statements: 80,
                branches: 65,
                functions: 80,
                lines: 80,
            },
        },
        include: ['src/js/**/*.test.js'],
    },
});
