import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getHistory, HISTORY_DAYS, MISSED_DAYS, type HistoryEntry } from '../../data/queries/agenda';
import { useQuery } from '../../data/useQuery';
import { localDateOf, startOfWeek, type LocalDate } from '../../domain/localDate';
import { shortDate } from '../../i18n/dates';
import { useWeekStartsOn } from '../settings/usePlanning';
import { noonOf } from '../../lib/dates';
import { Card } from '../../ui/Card';
import { Pill } from '../../ui/Pill';
import { StackScreen } from '../../ui/StackScreen';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext } from '../session/SessionProvider';
import { isHidden, usePendingDeletes } from './pendingDeletes';
import { TaskActionsProvider } from './TaskActions';
import { TaskRow } from './TaskRow';
import { UndoSnackbar } from './UndoSnackbar';

export type HistoryFilter = 'all' | 'done' | 'missed';

/** Entries grouped by day, newest day first (the query already sorts them). */
export function groupHistory(entries: readonly HistoryEntry[]): { day: LocalDate; entries: HistoryEntry[] }[] {
  const groups: { day: LocalDate; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.day === entry.day) last.entries.push(entry);
    else groups.push({ day: entry.day, entries: [entry] });
  }
  return groups;
}

/**
 * History: completed tasks grouped by the day they were done, with the missed occurrences of repeating tasks,
 * filters (All / Done / Missed) and the number done this week. Unticking a row restores the task.
 */
export function HistoryScreen({ now = new Date() }: { now?: Date }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ctx = useDataContext();
  const lang = i18n.language;
  const today = localDateOf(now);
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback((db: Parameters<typeof getHistory>[0]) => getHistory(db, ownerId, today), [ownerId, today]);
  const state = useQuery(query);
  const pending = usePendingDeletes((s) => s.pending);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const weekStartsOn = useWeekStartsOn();
  const weekStart = startOfWeek(today, weekStartsOn);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const filters = useMemo(
    () =>
      [
        { value: 'all', label: t('history.filterAll') },
        { value: 'done', label: t('history.filterDone') },
        { value: 'missed', label: t('history.filterMissed') },
      ] as const,
    [t],
  );

  return (
    <TaskActionsProvider now={now} onError={state.reload}>
      <StackScreen
        testID="screen-history"
        title={t('history.title')}
        backLabel={t('details.back')}
        onBack={back}
        footer={<UndoSnackbar bottom={insets.bottom + space.lg} />}
      >
        <AsyncContent
          state={state}
          onRetry={state.reload}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon="check" title={t('history.emptyTitle')} body={t('history.emptyBody')} />}
        >
          {(all) => {
            const visible = all.filter((e) => !isHidden(e.item, pending));
            const doneThisWeek = visible.filter((e) => !e.missed && e.day >= weekStart).length;
            const shown = visible.filter((e) => filter === 'all' || (filter === 'missed') === e.missed);
            const groups = groupHistory(shown);
            return (
              <View style={styles.list}>
                <Card style={styles.week} testID="history-week">
                  <Text variant="display" color={colors.text} style={styles.tabular}>
                    {doneThisWeek}
                  </Text>
                  <Text variant="body" color={colors.textSecondary} style={styles.flex}>
                    {t('history.doneThisWeek', { count: doneThisWeek })}
                  </Text>
                </Card>
                <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={t('history.filterLabel')}>
                  {filters.map((f) => (
                    <Pill
                      key={f.value}
                      testID={`history-filter-${f.value}`}
                      label={f.label}
                      selected={filter === f.value}
                      onPress={() => setFilter(f.value)}
                    />
                  ))}
                </View>
                {groups.length === 0 ? (
                  <Text variant="body" color={colors.textSecondary} testID="history-filter-empty">
                    {t(filter === 'missed' ? 'history.emptyMissed' : 'history.emptyDone')}
                  </Text>
                ) : null}
                {groups.map((g) => (
                  <View key={g.day} style={styles.group} testID={`history-day-${g.day}`}>
                    <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                      {g.day === today ? t('calendar.today') : shortDate(noonOf(g.day), lang)} · {g.entries.length}
                    </Text>
                    {g.entries.map((e) => (
                      <TaskRow
                        key={e.item.key}
                        item={e.item}
                        statusLabel={e.missed ? t('history.missed') : undefined}
                        showDate={
                          !e.missed && e.item.date && e.item.date !== g.day
                            ? shortDate(noonOf(e.item.date), lang)
                            : undefined
                        }
                      />
                    ))}
                  </View>
                ))}
                <Text variant="caption" color={colors.textSecondary}>
                  {t('history.range', { days: HISTORY_DAYS, missedDays: MISSED_DAYS })}
                </Text>
              </View>
            );
          }}
        </AsyncContent>
      </StackScreen>
    </TaskActionsProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: space.lg },
  week: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tabular: { fontVariant: ['tabular-nums'] },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  group: { gap: space.xs },
});
