/**
 * expo-notifications adapter (SDK 58): local notifications only, no push. The module is loaded lazily on first use,
 * so people who never turn a reminder on never load it (in Expo Go it prints a "not fully supported" warning on
 * import; local notifications still work there). Web has no local scheduling: reminders show as unavailable.
 */
import { Linking, Platform } from 'react-native';

import type { NotificationsApi } from './scheduler';

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
          // `goalId` drives the tap handler; task and routine reminders only carry their link for now.
          data: n.targetType === 'goal' ? { url: n.url, goalId: n.targetId } : { url: n.url },
        },
        // Inexact delivery is accepted (no exact-alarm permission requested; see ARCHITECTURE.md section 8).
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: n.fireAt, channelId: CHANNEL_ID },
      });
    },
    async cancel(id) {
      await load().cancelScheduledNotificationAsync(id);
    },
  };
}

/** Opens the goal when a reminder is tapped (cold start included). Returns an unsubscribe function. */
export function listenForReminderTaps(open: (goalId: string) => void): () => void {
  if (!remindersSupported) return () => undefined;
  const N = load();
  const handle = (data: unknown) => {
    const goalId = (data as { goalId?: unknown } | null)?.goalId;
    if (typeof goalId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(goalId)) open(goalId);
  };
  void N.getLastNotificationResponseAsync().then((r) => r && handle(r.notification.request.content.data));
  const sub = N.addNotificationResponseReceivedListener((r) => handle(r.notification.request.content.data));
  return () => sub.remove();
}
