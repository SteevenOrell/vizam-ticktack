/**
 * App-wide upkeep (see maintenance.ts): runs on start, when the app returns to the foreground and 1.5 s after local
 * or synced changes; the background task runs the same pass while the app is closed.
 */
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { subscribeDataChanges } from '../../data/changes';
import type { DataContext } from '../../data/store';
import { usePreferences } from '../../state/preferences';
import { listenForReminderTaps, remindersSupported } from './expoNotifications';
import { maintainGoals } from './maintenance';

export { maintainGoals } from './maintenance';

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

  // Tapping a reminder opens its goal, task day or routine (listener only once reminders are in use, to keep the
  // module lazy).
  useEffect(() => {
    if (!remindersUsed || !remindersSupported) return;
    return listenForReminderTaps((route) => router.push(route));
  }, [remindersUsed, router]);
}
