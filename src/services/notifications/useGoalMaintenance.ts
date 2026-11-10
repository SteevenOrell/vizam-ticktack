/**
 * App-wide goal upkeep: records ended periods of periodic goals (history), then rebuilds the reminder window.
 * Runs on start, when the app returns to the foreground and 1.5 s after local or synced changes. The OS module is
 * only loaded when some goal has a reminder on (or reminders were used on this device, to clean up after a wipe)
 * and permission is granted; otherwise reminders stay saved and nothing is scheduled.
 */
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import i18n from '../../i18n';
import { subscribeDataChanges } from '../../data/changes';
import { enforceGoalRepeats, rollGoalHistory } from '../../data/goals';
import type { DataContext } from '../../data/store';
import { usePreferences } from '../../state/preferences';
import {
  expoNotificationsApi,
  getReminderPermission,
  listenForReminderTaps,
  remindersSupported,
} from './expoNotifications';
import type { Translate } from './plan';
import { loadReminderInputs, rescheduleGoalReminders } from './scheduler';

const translate: Translate = (key, vars) => i18n.t(key as never, vars as never) as unknown as string;

export async function maintainGoals(ctx: DataContext): Promise<void> {
  try {
    await enforceGoalRepeats(ctx);
    await rollGoalHistory(ctx);
  } catch (e) {
    console.warn('Goal history update failed', e instanceof Error ? e.name : 'unknown');
  }
  if (!remindersSupported) return;
  try {
    const used = usePreferences.getState().remindersUsed;
    if (!used && (await loadReminderInputs(ctx.db, ctx.ownerId, new Date())).length === 0) return;
    if ((await getReminderPermission()) !== 'granted') return;
    await rescheduleGoalReminders({ db: ctx.db, ownerId: ctx.ownerId, api: expoNotificationsApi(), t: translate });
  } catch (e) {
    console.warn('Reminder scheduling failed', e instanceof Error ? e.name : 'unknown');
  }
}

export function useGoalMaintenance(ctx: DataContext | null): void {
  const router = useRouter();
  const remindersUsed = usePreferences((s) => s.remindersUsed);

  useEffect(() => {
    if (!ctx) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => void maintainGoals(ctx);
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 1500);
    };
    run();
    const unsubData = subscribeDataChanges(later);
    const app = AppState.addEventListener('change', (state) => state === 'active' && run());
    return () => {
      if (timer) clearTimeout(timer);
      unsubData();
      app.remove();
    };
  }, [ctx]);

  // Tapping a reminder opens its goal (listener only once reminders are in use, to keep the module lazy).
  useEffect(() => {
    if (!remindersUsed || !remindersSupported) return;
    return listenForReminderTaps((goalId) => router.push({ pathname: '/goal/[id]', params: { id: goalId } }));
  }, [remindersUsed, router]);
}
