import { Platform } from 'react-native';

import { isExact, resolveExactAlarm, schedulesExact } from '../notifications/exactAlarm';

jest.mock('expo', () => ({ isRunningInExpoGo: jest.fn(() => false) }));

const expo = jest.requireMock<{ isRunningInExpoGo: jest.Mock }>('expo');
const N = jest.requireMock<Record<string, jest.Mock | undefined>>('expo-notifications');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('../notifications/expoNotifications') as typeof import('../notifications/expoNotifications');

let os = 'android';
const realOs = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true }));
afterAll(() => Object.defineProperty(Platform, 'OS', { value: realOs, configurable: true }));
beforeEach(() => {
  os = 'android';
  expo.isRunningInExpoGo.mockReturnValue(false);
  N.getExactAlarmPermissionsAsync = jest.fn(async () => ({ granted: false, canAskAgain: true }));
  N.requestExactAlarmPermissionsAsync = jest.fn(async () => ({ granted: true, canAskAgain: true }));
});
afterEach(() => {
  delete N.getExactAlarmPermissionsAsync;
  delete N.requestExactAlarmPermissionsAsync;
});

describe('resolveExactAlarm (pure)', () => {
  it.each([
    [{ platform: 'ios', expoGo: false, permission: null }, 'notNeeded'],
    [{ platform: 'android', expoGo: false, permission: { granted: true } }, 'granted'],
    [{ platform: 'android', expoGo: false, permission: { granted: false, canAskAgain: true } }, 'askable'],
    [{ platform: 'android', expoGo: true, permission: { granted: false, canAskAgain: true } }, 'unavailable'],
    [{ platform: 'android', expoGo: false, permission: { granted: false, canAskAgain: false } }, 'unavailable'],
    [{ platform: 'android', expoGo: false, permission: null }, 'unavailable'],
  ] as const)('%j -> %s', (facts, state) => {
    expect(resolveExactAlarm(facts)).toBe(state);
  });

  it('only a granted Android records exact scheduling; iOS is on time without it', () => {
    expect(schedulesExact('granted')).toBe(true);
    expect(['notNeeded', 'askable', 'unavailable'].map((s) => schedulesExact(s as never))).toEqual([
      false,
      false,
      false,
    ]);
    expect(isExact('notNeeded')).toBe(true);
    expect(isExact('askable')).toBe(false);
  });
});

describe('exact-alarm adapter and fallback', () => {
  it('asks only when askable, then reports the state on return', async () => {
    expect(await mod.getExactAlarmState()).toBe('askable');
    N.requestExactAlarmPermissionsAsync!.mockImplementation(async () => {
      N.getExactAlarmPermissionsAsync!.mockResolvedValue({ granted: true, canAskAgain: true });
      return { granted: true };
    });
    expect(await mod.requestExactAlarm()).toBe('granted');
    expect(N.requestExactAlarmPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('stays inexact when the user comes back without allowing it', async () => {
    N.requestExactAlarmPermissionsAsync!.mockResolvedValue({ granted: false, canAskAgain: true });
    expect(await mod.requestExactAlarm()).toBe('askable');
  });

  it('Expo Go: never opens the setting, reminders stay inexact', async () => {
    expo.isRunningInExpoGo.mockReturnValue(true);
    expect(await mod.getExactAlarmState()).toBe('unavailable');
    expect(await mod.requestExactAlarm()).toBe('unavailable');
    expect(N.requestExactAlarmPermissionsAsync).not.toHaveBeenCalled();
  });

  it('a build without the permission, a failing check or a rejected request fall back to inexact', async () => {
    N.getExactAlarmPermissionsAsync!.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await mod.requestExactAlarm()).toBe('unavailable');
    expect(N.requestExactAlarmPermissionsAsync).not.toHaveBeenCalled();

    N.getExactAlarmPermissionsAsync!.mockRejectedValue(new Error('not declared'));
    expect(await mod.getExactAlarmState()).toBe('unavailable');

    N.getExactAlarmPermissionsAsync!.mockResolvedValue({ granted: false, canAskAgain: true });
    N.requestExactAlarmPermissionsAsync!.mockRejectedValue(new Error('not declared'));
    expect(await mod.requestExactAlarm()).toBe('unavailable');
  });

  it('iOS needs nothing and never calls the Android API', async () => {
    os = 'ios';
    expect(await mod.getExactAlarmState()).toBe('notNeeded');
    expect(await mod.requestExactAlarm()).toBe('notNeeded');
    expect(N.getExactAlarmPermissionsAsync).not.toHaveBeenCalled();
  });

  it('inexact scheduling uses the same trigger (the OS decides the precision)', async () => {
    const api = mod.expoNotificationsApi();
    const n = {
      id: 'tt_t1_task',
      targetType: 'task' as const,
      targetId: 't1',
      occurrenceId: null,
      kind: 'task' as const,
      key: 't1',
      fireAt: 1,
      title: 'Dentist',
      body: 'notifications.taskToday',
      url: 'ticktack://task/details/t1',
      fingerprint: 'f',
    };
    await api.schedule(n, { exact: false });
    await api.schedule(n, { exact: true });
    const [a, b] = N.scheduleNotificationAsync!.mock.calls.slice(-2);
    expect(a).toEqual(b);
    expect(a[0].trigger).toEqual({ type: 'date', date: 1, channelId: 'reminders' });
  });
});
