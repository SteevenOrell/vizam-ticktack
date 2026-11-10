// babel-preset-expo is a dependency of expo, not a top-level package.
const babelPresetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });

/** Firestore security rules tests. Run with `npm run test:rules` (starts the Firestore emulator). */
module.exports = {
  testEnvironment: 'node',
  // testRegex instead of a glob: the repo may live under a dot-folder (e.g. .claude/worktrees), which globs skip.
  testRegex: String.raw`tests[\\/]rules[\\/].*\.test\.ts$`,
  transform: { '^.+\\.ts$': ['babel-jest', { presets: [babelPresetExpo] }] },
  testTimeout: 20000,
  // Suites share one emulator and the rules suite clears Firestore between tests: run files one at a time.
  maxWorkers: 1,
};
