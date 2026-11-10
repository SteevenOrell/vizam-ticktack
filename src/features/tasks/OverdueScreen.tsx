import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getOverdue, OVERDUE_LIMIT, type AgendaItem } from '../../data/queries/agenda';
import { moveToDate } from '../../data/tasks';
import { useQuery } from '../../data/useQuery';
import { localDateOf } from '../../domain/localDate';
import { shortDate } from '../../i18n/dates';
import { noonOf } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { StackScreen } from '../../ui/StackScreen';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext } from '../session/SessionProvider';
import { isHidden, usePendingDeletes } from './pendingDeletes';
import { TaskActionsProvider, useTaskActions } from './TaskActions';
import { TaskRow } from './TaskRow';
import { UndoSnackbar } from './UndoSnackbar';

function OverdueItem({ item, onMove }: { item: AgendaItem; onMove: (item: AgendaItem) => void }) {
  const { t, i18n } = useTranslation();
  const actions = useTaskActions();
  return (
    <View style={styles.item} testID={`overdue-${item.key}`}>
      <TaskRow item={item} overdue showDate={shortDate(noonOf(item.date), i18n.language)} />
      <View style={styles.itemActions}>
        <Button
          testID={`overdue-today-${item.key}`}
          label={t('overdue.moveToToday')}
          accessibilityLabel={t('overdue.moveToTodayLabel', { title: item.title })}
          variant="secondary"
          size="compact"
          icon="calendar"
          onPress={() => onMove(item)}
        />
        <Button
          testID={`overdue-done-${item.key}`}
          label={t('tasks.menuDone')}
          accessibilityLabel={t('tasks.markDone', { title: item.title })}
          variant="secondary"
          size="compact"
          icon="check"
          onPress={() => actions.toggle(item, true)}
        />
      </View>
    </View>
  );
}

/**
 * Overdue view: open one-off tasks dated before today, oldest first, each with "Move to today" and "Mark done"
 * (plus the usual row actions), and "Move all to today" on top.
 */
export function OverdueScreen({ now = new Date() }: { now?: Date }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ctx = useDataContext();
  const today = localDateOf(now);
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback((db: Parameters<typeof getOverdue>[0]) => getOverdue(db, ownerId, today), [ownerId, today]);
  const state = useQuery(query);
  const pending = usePendingDeletes((s) => s.pending);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const move = async (items: AgendaItem[]) => {
    if (!ctx || busy) return;
    setBusy(true);
    setError(false);
    try {
      for (const item of items) await moveToDate(ctx, { taskId: item.taskId }, today);
    } catch (e) {
      console.warn('Move to today failed', e instanceof Error ? e.name : 'unknown');
      setError(true);
      state.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <TaskActionsProvider now={now} onError={state.reload}>
      <StackScreen
        testID="screen-overdue"
        title={t('overdue.title')}
        backLabel={t('details.back')}
        onBack={back}
        footer={<UndoSnackbar bottom={insets.bottom + space.lg} />}
      >
        <AsyncContent
          state={state}
          onRetry={state.reload}
          isEmpty={(d) => d.length === 0}
          empty={
            <EmptyState
              icon="check"
              title={t('overdue.emptyTitle')}
              body={t('overdue.emptyBody')}
              action={{ label: t('overdue.backToToday'), onPress: back }}
            />
          }
        >
          {(all) => {
            const items = all.filter((i) => !isHidden(i, pending));
            return (
              <View style={styles.list}>
                <View style={styles.top}>
                  <Text variant="body" color={colors.textSecondary} style={styles.flex} testID="overdue-count">
                    {all.length >= OVERDUE_LIMIT
                      ? t('overdue.countCapped', { count: OVERDUE_LIMIT })
                      : t('overdue.count', { count: items.length })}
                  </Text>
                  {items.length > 1 ? (
                    <Button
                      testID="overdue-move-all"
                      label={t('overdue.moveAll')}
                      variant="secondary"
                      size="compact"
                      disabled={busy}
                      onPress={() => void move(items)}
                    />
                  ) : null}
                </View>
                {error ? (
                  <Text
                    variant="bodySm"
                    color={colors.danger}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                  >
                    {t('editor.errors.saveFailed')}
                  </Text>
                ) : null}
                {items.map((item) => (
                  <OverdueItem key={item.key} item={item} onMove={(i) => void move([i])} />
                ))}
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
  list: { gap: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  item: { gap: space.xxs },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.xs },
});
