/** Unit, data and UI tests. Firestore rules tests run separately with jest.rules.config.js inside the emulator. */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // UI suites render whole screens over SQLite; the first test in a file can take well over 5 s on a cold cache.
  // Phase 5b: 60 s (was 30 s). The full run shares the machine with other agents and servers; a slow worker must not
  // fail a test that is merely late. A real hang still fails, just later.
  testTimeout: 60000,
  testPathIgnorePatterns: ['/node_modules/', String.raw`[\\/]tests[\\/]rules[\\/]`],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|react-native-calendars|i18next|react-i18next))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
