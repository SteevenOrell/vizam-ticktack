/**
 * expo-notifications adapter (SDK 58): local notifications only, no push. The module is loaded lazily on first use,
 * so people who never turn a reminder on never load it (in Expo Go it prints a "not fully supported" warning on
 * import; local notifications still work there). Web has no local scheduling: reminders show as unavailable.
 */
import { isRunningInExpoGo } from 'expo';
import { Linking, Platform } from 'react-native';

import { resolveExactAlarm, type ExactAlarmFacts, type ExactAlarmState } from './exactAlarm';
import type { NotificationsApi } from './scheduler';
import { reminderPayload, reminderRoute, type ReminderRoute } from './tapRoute';

type ExpoNotifications = typeof import('expo-notifications');

export const CHANNEL_ID = 'reminders';
export const remindersSupported = Platform.OS === 'ios' || Platform.OS === 'android';

let mod: ExpoNotifications | null = null;
let setup: Promise<void> | null = null;

function load(): ExpoNotifications {
  // Lazy require keeps the module (and its Expo Go warnings) out of start-up until reminders are used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod ??= require('expo-notifications') as ExpoNotifications;
  return mod;
}

/** Foreground presentation and the Android channel (created once; only name/description can change later). */
function ensureSetup(N: ExpoNotifications): Promise<void> {
  setup ??= (async () => {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Reminders',
        importance: N.AndroidImportance.HIGH,
      });
    }
  })();
  return setup;
}

export type ReminderPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function toPermission(p: { granted: boolean; status: string; canAskAgain?: boolean }): ReminderPermission {
  if (p.granted) return 'granted';
  if (p.status === 'denied' || p.canAskAgain === false) return 'denied';
  return 'undetermined';
}

export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported) return 'unavailable';
  try {
    return toPermission(await load().getPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

/** Shows the OS prompt (only call after the in-app explanation). Denied stays denied until the user opens Settings. */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported) return 'unavailable';
  try {
    const N = load();
    await ensureSetup(N);
    const current = await N.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain) return 'denied';
    return toPermission(
      await N.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } }),
    );
  } catch {
    return 'unavailable';
  }
}

/** Exact-alarm access on this device (see exactAlarm.ts). Never throws; a failed check counts as unavailable. */
export async function getExactAlarmState(): Promise<ExactAlarmState> {
  const platform = Platform.OS;
  if (platform !== 'android') return resolveExactAlarm({ platform, expoGo: false, permission: null });
  let permission: ExactAlarmFacts['permission'] = null;
  try {
    permission = await load().getExactAlarmPermissionsAsync();
  } catch {
    permission = null;
  }
  return resolveExactAlarm({ platform, expoGo: isRunningInExpoGo(), permission });
}

/**
 * Opens the system "Alarms & reminders" screen (only after the in-app explanation) and reports the state on return.
 * Does nothing unless the state is askable, so Expo Go and builds without the permission never call it.
 */
export async function requestExactAlarm(): Promise<ExactAlarmState> {
  const before = await getExactAlarmState();
  if (before !== 'askable') return before;
  try {
    await load().requestExactAlarmPermissionsAsync();
  } catch {
    return 'unavailable';
  }
  return getExactAlarmState();
}

export function openNotificationSettings(): void {
  void Linking.openSettings();
}

/** NotificationsApi backed by the OS scheduler. */
export function expoNotificationsApi(): NotificationsApi {
  return {
    async getScheduledIds() {
      const N = load();
      return (await N.getAllScheduledNotificationsAsync()).map((r) => r.identifier);
    },
    async schedule(n) {
      const N = load();
      await ensureSetup(N);
      await N.scheduleNotificationAsync({
        identifier: n.id,
        content: {
          title: n.title,
          body: n.body,
          // Read back by the tap handler (see tapRoute.ts).
          data: reminderPayload(n),
        },
        // Default delivery ('bestEffort'): exact once exact-alarm access is granted, approximate otherwise
        // (see exactAlarm.ts), so the same call is the fallback.
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: n.fireAt, channelId: CHANNEL_ID },
      });
    },
    async cancel(id) {
      await load().cancelScheduledNotificationAsync(id);
    },
  };
}

/**
 * Opens the goal, task (day) or routine when a reminder is tapped (cold start included). The last response is
 * handled once per process, so remounting the listener does not open it again. Returns an unsubscribe function.
 */
export function listenForReminderTaps(open: (route: ReminderRoute) => void): () => void {
  if (!remindersSupported) return () => undefined;
  const N = load();
  const handle = (r: {
    notification: { date: number; request: { identifier: string; content: { data?: unknown } } };
  }) => {
    const key = `${r.notification.request.identifier}@${r.notification.date}`;
    if (lastHandled === key) return;
    lastHandled = key;
    const route = reminderRoute(r.notification.request.content.data);
    if (route) open(route);
  };
  void N.getLastNotificationResponseAsync().then((r) => r && handle(r));
  const sub = N.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

let lastHandled: string | null = null;
