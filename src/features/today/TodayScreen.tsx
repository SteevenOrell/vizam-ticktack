import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { getTodayView, type AgendaItem, type TodayView } from '../../data/queries/agenda';
import { setDone } from '../../data/tasks';
import { useQuery } from '../../data/useQuery';
import { localDateOf } from '../../domain/localDate';
import { dayFaceParts, shortDate } from '../../i18n/dates';
import { formatMinutes, noonOf } from '../../lib/dates';
import { useSession } from '../../state/session';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { Icon } from '../../ui/Icon';
import { ProgressBar } from '../../ui/ProgressBar';
import { RoundAction } from '../../ui/RoundAction';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext, useServices } from '../session/SessionProvider';
import { TaskRow } from '../tasks/TaskRow';

/** Opens the editor for a task or one occurrence (`?occ=`). Routines open in phase 4. */
export function openItem(router: ReturnType<typeof useRouter>, item: AgendaItem) {
  if (item.kind === 'routine') return;
  router.push({
    pathname: '/task/[id]',
    params: item.occurrenceId ? { id: item.taskId, occ: item.occurrenceId } : { id: item.taskId },
  });
}

function Group({
  title,
  items,
  onToggle,
  onOpen,
  overdue,
  testID,
  collapsible,
}: {
  title: string;
  items: AgendaItem[];
  onToggle: (item: AgendaItem, done: boolean) => void;
  onOpen: (item: AgendaItem) => void;
  overdue?: boolean;
  testID: string;
  collapsible?: { open: boolean; toggle: () => void };
}) {
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  if (items.length === 0) return null;
  const open = collapsible ? collapsible.open : true;
  const header = (
    <View style={styles.groupHeader}>
      <Text variant="label" color={overdue ? colors.danger : colors.textSecondary} accessibilityRole="header">
        {title} · {items.length}
      </Text>
      {collapsible ? (
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} color={colors.textSecondary} />
      ) : null}
    </View>
  );
  return (
    <View style={styles.group} testID={testID}>
      {collapsible ? (
        <Pressable
          onPress={collapsible.toggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${title}, ${items.length}`}
          style={styles.collapse}
        >
          {header}
        </Pressable>
      ) : (
        header
      )}
      {open
        ? items.map((item) => (
            <TaskRow
              key={item.key}
              item={item}
              onToggle={onToggle}
              onOpen={item.kind === 'routine' ? undefined : onOpen}
              overdue={overdue}
              showDate={overdue ? shortDate(noonOf(item.date), i18n.language) : undefined}
            />
          ))
        : null}
    </View>
  );
}

export function TodayScreen({ now = new Date() }: { now?: Date }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const ctx = useDataContext();
  const { syncNow } = useServices();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const lang = i18n.language;
  const date = localDateOf(now);
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback(
    (db: Parameters<typeof getTodayView>[0]) => getTodayView(db, ownerId, date),
    [ownerId, date],
  );
  const state = useQuery(query);
  const face = useMemo(() => dayFaceParts(now, lang), [now, lang]);
  const on = theme.header.on;
  const [showDone, setShowDone] = useState(false);
  const [showOverdue, setShowOverdue] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const view: TodayView | null = state.status === 'success' ? state.data : null;
  const planned = formatMinutes(view?.plannedMin ?? 0, lang);
  const capacity = formatMinutes(view?.capacityMin ?? 480, lang);
  const over = !!view && view.plannedMin > view.capacityMin;
  const addTask = () => router.push('/task/new');
  const onToggle = useCallback(
    (item: AgendaItem, done: boolean) => {
      if (!ctx) return;
      void setDone(ctx, { taskId: item.taskId, occurrenceId: item.occurrenceId }, done).catch(() => state.reload());
    },
    [ctx, state],
  );
  const onOpen = useCallback((item: AgendaItem) => openItem(router, item), [router]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncNow();
    state.reload();
    setRefreshing(false);
  }, [syncNow, state]);

  const isEmpty = (d: TodayView) =>
    d.overdue.length + d.scheduled.length + d.anytime.length + d.routines.length + d.done.length === 0;

  return (
    <HeaderScreen
      testID="screen-today"
      title={t('today.title')}
      refreshControl={
        signedIn ? (
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.colors.accent} />
        ) : undefined
      }
      action={
        <RoundAction
          icon="bell"
          accessibilityLabel={t('today.remindersAction')}
          background={on.actionBg}
          foreground={on.actionFg}
          accessibilityHint={t('states.comingSoon')}
        />
      }
      header={
        <View style={styles.face}>
          <View style={styles.faceRow}>
            <Text variant="dayFace" color={on.text}>
              {face.day}
            </Text>
            <View style={styles.faceMeta}>
              <Text variant="title2" color={on.text}>
                {face.month}
              </Text>
              <Text variant="bodySm" color={on.textSecondary} style={lang === 'fr' ? null : styles.weekday}>
                {face.weekday}
              </Text>
            </View>
          </View>
          <ProgressBar
            value={view ? view.plannedMin / Math.max(1, view.capacityMin) : 0}
            fill={on.fill}
            track={on.trackBg}
            accessibilityLabel={t('today.workloadLabel', { planned, capacity })}
          />
          <Text variant="label" color={on.textSecondary}>
            {over ? t('today.overPlanned', { planned, capacity }) : t('today.workload', { planned, capacity })}
          </Text>
        </View>
      }
      footer={
        <View style={styles.fab} pointerEvents="box-none">
          <RoundAction icon="plus" accessibilityLabel={t('today.addTask')} onPress={addTask} testID="fab-add" />
        </View>
      }
    >
      <AsyncContent
        state={state}
        onRetry={state.reload}
        isEmpty={isEmpty}
        empty={
          <EmptyState
            icon="today"
            title={t('today.emptyTitle')}
            body={t('today.emptyBody')}
            action={{ label: t('today.addTask'), onPress: addTask }}
          />
        }
      >
        {(d) => (
          <View style={styles.list}>
            <Group
              title={t('today.overdue')}
              items={d.overdue}
              onToggle={onToggle}
              onOpen={onOpen}
              overdue
              testID="group-overdue"
              collapsible={{ open: showOverdue, toggle: () => setShowOverdue((v) => !v) }}
            />
            <Group
              title={t('today.scheduled')}
              items={d.scheduled}
              onToggle={onToggle}
              onOpen={onOpen}
              testID="group-scheduled"
            />
            <Group
              title={t('today.anytime')}
              items={d.anytime}
              onToggle={onToggle}
              onOpen={onOpen}
              testID="group-anytime"
            />
            <Group
              title={t('today.routines')}
              items={d.routines}
              onToggle={onToggle}
              onOpen={onOpen}
              testID="group-routines"
            />
            <Group
              title={t('today.done')}
              items={d.done}
              onToggle={onToggle}
              onOpen={onOpen}
              testID="group-done"
              collapsible={{ open: showDone, toggle: () => setShowDone((v) => !v) }}
            />
            {d.scheduled.length + d.anytime.length + d.overdue.length === 0 && d.done.length > 0 ? (
              <Text variant="body" color={theme.colors.textSecondary} align="center">
                {t('today.allDone')}
              </Text>
            ) : null}
          </View>
        )}
      </AsyncContent>
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  face: { marginTop: space.lg, gap: space.sm },
  faceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  faceMeta: { paddingBottom: space.xs, flexShrink: 1 },
  weekday: { textTransform: 'capitalize' },
  list: { gap: space.lg, paddingBottom: space.huge + space.xl },
  group: { gap: space.xs },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs },
  collapse: { minHeight: 44, justifyContent: 'center' },
  fab: { position: 'absolute', right: space.lg, bottom: space.lg },
});
