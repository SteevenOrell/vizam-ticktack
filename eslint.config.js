// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['dist/*', 'coverage/*', '.expo/*', 'node_modules/*', 'web-build/*'],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**', 'tests/**', '**/*.test.ts', '**/*.test.tsx', 'jest.*.js', '*.config.js'],
    rules: { 'no-console': 'off' },
  },
]);
