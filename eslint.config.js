import js from '@eslint/js';
import globals from 'globals';
import css from '@eslint/css';
import { defineConfig } from 'eslint/config';
import pluginSecurity from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

export default defineConfig([
    {
        ignores: ['dist/**/*', 'node_modules/**/*'],
    },
    {
        files: ['**/*.{js,mjs,cjs}'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        plugins: {
            js,
            security: pluginSecurity,
            sonarjs,
            'no-unsanitized': noUnsanitized,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...pluginSecurity.configs.recommended.rules,
            ...sonarjs.configs.recommended.rules,
            ...noUnsanitized.configs.recommended.rules,
        },
    },
    {
        files: ['**/*.css'],
        plugins: { css },
        language: 'css/css',
        extends: ['css/recommended'],
        rules: {
            'css/use-baseline': 'off',
        },
    },
]);
