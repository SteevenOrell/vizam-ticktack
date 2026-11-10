import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
// Real UUIDs in tests (the native module is not available under Jest).
jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('crypto').randomUUID(),
}));

// UI flows that save through SQLite can exceed the default 1 s waitFor on a cold, uncached run.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });
