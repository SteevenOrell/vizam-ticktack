/**
 * Android exact alarms (pure decision logic; the OS calls live in expoNotifications.ts).
 *
 * Decision (Steeven, phase 4b): ask users for exact-alarm access. The app declares
 * `android.permission.SCHEDULE_EXACT_ALARM` (app.config.ts), explains it in-app, then opens the system screen.
 * Android 14+ denies it by default for new installs, so "not granted" is the normal first state.
 *
 * Fallback: nothing is lost without the permission. Reminders are scheduled the same way (`delivery: 'bestEffort'`,
 * the SDK 58 default); the OS then delivers them at an approximate time, and at the exact time once access is
 * granted. `delivery: 'alarmClock'` is deliberately not used: it shows an alarm icon in the status bar for every
 * pending reminder and is meant for alarm clocks.
 */
export type ExactAlarmState =
  /** iOS and web: local notifications are already on time, nothing to ask. */
  | 'notNeeded'
  /** Android with exact-alarm access: reminders are on time. */
  | 'granted'
  /** Android without access, and the user can be sent to the system setting. */
  | 'askable'
  /** Android where asking is not possible (Expo Go, or a build without the permission): inexact reminders. */
  | 'unavailable';

export interface ExactAlarmFacts {
  platform: string;
  /** Running inside Expo Go, whose own manifest decides the permissions. */
  expoGo: boolean;
  /** Result of `getExactAlarmPermissionsAsync`, or null when the call failed or is missing. */
  permission: { granted: boolean; canAskAgain?: boolean } | null;
}

export function resolveExactAlarm({ platform, expoGo, permission }: ExactAlarmFacts): ExactAlarmState {
  if (platform !== 'android') return 'notNeeded';
  if (!permission) return 'unavailable';
  if (permission.granted) return 'granted';
  // Expo Go does not declare the permission for us; a build without it reports `canAskAgain: false`.
  if (expoGo || permission.canAskAgain === false) return 'unavailable';
  return 'askable';
}

/** Whether reminders are delivered at the exact time in this state. */
export const isExact = (state: ExactAlarmState): boolean => state === 'granted' || state === 'notNeeded';

/** Whether the scheduler should record "exact" for this state (Android with access only; see ScheduleOptions). */
export const schedulesExact = (state: ExactAlarmState): boolean => state === 'granted';
