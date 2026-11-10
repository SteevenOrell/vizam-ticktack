import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
// Real UUIDs in tests (the native module is not available under Jest).
jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('crypto').randomUUID(),
}));

// Local notifications: a small stand-in for expo-notifications (tests drive permissions per case).
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { HIGH: 6 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

// UI flows that save through SQLite can exceed the default 1 s waitFor on a cold, uncached run.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });
