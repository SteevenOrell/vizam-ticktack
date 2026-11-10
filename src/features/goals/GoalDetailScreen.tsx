import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteGoal, getGoalDetail, GoalNeedsTaskError, linkTasks, setGoalDone, unlinkTask } from '../../data/goals';
import { useQuery } from '../../data/useQuery';
import { localDateOf } from '../../domain/localDate';
import type { GoalReminders } from '../../domain/models';
import { shortDate, weekdayNames } from '../../i18n/dates';
import { formatClock, noonOf } from '../../lib/dates';
import { remindersSupported } from '../../services/notifications/expoNotifications';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { CategoryDot } from '../../ui/Checkbox';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { ProgressArc } from '../../ui/ProgressArc';
import { ProgressBar } from '../../ui/ProgressBar';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { radii, sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { fontFamilies } from '../../ui/theme/typography';
import { useDataContext } from '../session/SessionProvider';
import { isHidden, scheduleDelete, usePendingDeletes } from '../tasks/pendingDeletes';
import { TaskActionsProvider } from '../tasks/TaskActions';
import { TaskRow } from '../tasks/TaskRow';
import { countdown, dueLabel, periodLabel, rangeLabel } from './goalFormat';
import { anyReminderOn } from './RemindersEditor';
import { TaskPickerSheet } from './TaskPickerSheet';

function reminderLines(t: TFunction, lang: string, r: GoalReminders, period: string): string[] {
  const lines: string[] = [];
  if (r.beforeDue.length) {
    lines.push(
      t('reminders.summaryBeforeDue', {
        when: r.beforeDue.map((o) => t(`reminders.offset_${o}`)).join(', '),
        time: formatClock(r.beforeDueTime, lang),
      }),
    );
  }
  if (r.eachStep) lines.push(t('reminders.eachStep'));
  if (r.monthlyDay) {
    lines.push(t('reminders.summaryMonthly', { day: r.monthlyDay, time: formatClock(r.monthlyTime, lang) }));
  }
  if (r.periodic && period === 'daily')
    lines.push(t('reminders.summaryDaily', { time: formatClock(r.periodicTime, lang) }));
  if (r.periodic && period === 'weekly') {
    lines.push(
      t('reminders.summaryWeekly', {
        day: weekdayNames(lang)[r.periodicWeekday] ?? '',
        time: formatClock(r.periodicTime, lang),
      }),
    );
  }
  return lines;
}

/** Goal details: progress arc with %, due date and countdown, linked tasks (tickable), reminders, history. */
export function GoalDetailScreen({ goalId, now = new Date() }: { goalId: string; now?: Date }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ctx = useDataContext();
  const lang = i18n.language;
  const today = localDateOf(now);
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback(
    (db: Parameters<typeof getGoalDetail>[0]) => getGoalDetail(db, ownerId, goalId, today),
    [ownerId, goalId, today],
  );
  const state = useQuery(query);
  const pending = usePendingDeletes((s) => s.pending);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picker, setPicker] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/goals');
  }, [router]);

  const fail = (e: unknown) => {
    console.warn('Goal action failed', e instanceof Error ? e.name : 'unknown');
    setNotice(t(e instanceof GoalNeedsTaskError ? 'goals.errors.lastTask' : 'goals.errors.saveFailed'));
    state.reload();
  };

  return (
    <TaskActionsProvider now={now} onError={state.reload}>
      <View style={[styles.root, { backgroundColor: colors.bg }]} testID="screen-goal-detail">
        <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
          <Pressable
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel={t('goals.back')}
            style={styles.iconButton}
            testID="goal-back"
          >
            <Icon name="chevronLeft" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.flex} />
          {state.status === 'success' && state.data ? (
            <Button
              testID="edit-goal"
              label={t('goals.edit')}
              variant="secondary"
              size="compact"
              icon="edit"
              onPress={() => router.push({ pathname: '/goal/edit/[id]', params: { id: goalId } })}
            />
          ) : null}
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.huge }]}>
          <AsyncContent
            state={state}
            onRetry={state.reload}
            isEmpty={(d) => d === null}
            empty={
              <EmptyState
                icon="goals"
                title={t('goals.notFound')}
                body={t('goals.notFoundBody')}
                action={{ label: t('goals.back'), onPress: back }}
              />
            }
          >
            {(detail) => {
              if (!detail) return null;
              const { goal, summary } = detail;
              const pct = summary.progress.percent;
              const achieved = goal.status === 'achieved';
              const items = detail.items.filter((i) => !isHidden(i, pending));
              const reminders = reminderLines(t, lang, goal.reminders, goal.period);
              return (
                <View style={styles.stack}>
                  <View style={styles.titleBlock}>
                    <Text variant="title1" accessibilityRole="header">
                      {goal.title}
                    </Text>
                    {goal.description ? (
                      <Text variant="bodySm" color={colors.textSecondary}>
                        {goal.description}
                      </Text>
                    ) : null}
                  </View>

                  <Card style={styles.hero} testID="goal-hero">
                    <ProgressArc
                      value={pct / 100}
                      fill={pct >= 100 ? colors.success : colors.accent}
                      track={colors.chip}
                      accessibilityLabel={t('goals.progressLabel', { title: goal.title, percent: pct })}
                      testID="goal-progress"
                    >
                      <Text style={[styles.pct, { color: colors.text }]}>
                        {pct}
                        <Text style={[styles.pctSign, { color: colors.textSecondary }]}>%</Text>
                      </Text>
                    </ProgressArc>
                    <View style={styles.heroText}>
                      <View style={[styles.chip, { backgroundColor: colors.chip }]}>
                        {goal.color ? <CategoryDot color={goal.color} size={8} /> : null}
                        <Text variant="caption" weight={500}>
                          {periodLabel(t, goal.period)}
                        </Text>
                      </View>
                      <Text
                        variant="title3"
                        color={summary.section === 'overdue' ? colors.danger : colors.text}
                        testID="goal-countdown"
                      >
                        {achieved ? t('goals.achieved') : countdown(t, summary.daysLeft)}
                      </Text>
                      <Text variant="bodySm" color={colors.textSecondary}>
                        {dueLabel(t, lang, goal.period, summary.due)}
                      </Text>
                      <Text variant="caption" color={colors.textSecondary}>
                        {goal.period === 'once'
                          ? t('goals.doneOfTotal', { done: summary.progress.done, total: summary.progress.total })
                          : t('goals.thisPeriod', {
                              range: rangeLabel(lang, summary.range.start, summary.range.end),
                              done: summary.progress.done,
                              total: summary.progress.total,
                            })}
                      </Text>
                    </View>
                  </Card>

                  <Button
                    testID="goal-toggle-done"
                    label={achieved ? t('goals.reopen') : t('goals.markDone')}
                    variant="secondary"
                    icon="check"
                    onPress={() => ctx && void setGoalDone(ctx, goal.id, !achieved).catch(fail)}
                    fullWidth
                  />

                  {notice ? (
                    <Text variant="bodySm" color={colors.danger} accessibilityLiveRegion="polite" testID="goal-notice">
                      {notice}
                    </Text>
                  ) : null}

                  <View style={styles.section}>
                    <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                      {t('goals.tasksCount', { count: detail.linkedIds.length })}
                    </Text>
                    {items.map((item) => (
                      <View key={item.key} style={styles.taskRow}>
                        <View style={styles.flex}>
                          <TaskRow
                            item={item}
                            showDate={item.date ? shortDate(noonOf(item.date), lang) : t('editor.noDate')}
                          />
                        </View>
                        <Pressable
                          onPress={() => {
                            if (!ctx) return;
                            setNotice(null);
                            void unlinkTask(ctx, goal.id, item.taskId).catch(fail);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={t('goals.unlinkTask', { title: item.title })}
                          accessibilityHint={detail.linkedIds.length <= 1 ? t('goals.errors.lastTask') : undefined}
                          style={styles.iconButton}
                          testID={`unlink-${item.taskId}`}
                        >
                          <Icon name="close" size={18} color={colors.textSecondary} />
                        </Pressable>
                      </View>
                    ))}
                    <Button
                      testID="goal-add-tasks"
                      label={t('goals.addTasks')}
                      variant="secondary"
                      icon="plus"
                      onPress={() => setPicker(true)}
                      fullWidth
                    />
                  </View>

                  <View style={styles.section} testID="goal-reminders">
                    <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                      {t('reminders.title')}
                    </Text>
                    <Card style={styles.remCard}>
                      <Icon
                        name="bell"
                        size={18}
                        color={anyReminderOn(goal.reminders, goal.period) ? colors.accentText : colors.textSecondary}
                      />
                      <View style={styles.flex}>
                        {reminders.length ? (
                          reminders.map((line) => (
                            <Text key={line} variant="bodySm">
                              {line}
                            </Text>
                          ))
                        ) : (
                          <Text variant="bodySm" color={colors.textSecondary}>
                            {t('reminders.none')}
                          </Text>
                        )}
                        {!remindersSupported ? (
                          <Text variant="caption" color={colors.textSecondary}>
                            {t('reminders.webUnavailable')}
                          </Text>
                        ) : null}
                      </View>
                    </Card>
                  </View>

                  {goal.period !== 'once' ? (
                    <View style={styles.section} testID="goal-history">
                      <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                        {t('goals.history')}
                      </Text>
                      {detail.history.length === 0 ? (
                        <Text variant="bodySm" color={colors.textSecondary}>
                          {t('goals.historyEmpty')}
                        </Text>
                      ) : (
                        detail.history.slice(0, 12).map((h) => (
                          <View key={h.start} style={styles.historyRow}>
                            <Text variant="bodySm" style={styles.historyLabel} numberOfLines={1}>
                              {rangeLabel(lang, h.start, h.end)}
                            </Text>
                            <View style={styles.flex}>
                              <ProgressBar
                                value={h.percent / 100}
                                fill={colors.accent}
                                track={colors.chip}
                                height={6}
                                accessibilityLabel={t('goals.historyLabel', {
                                  range: rangeLabel(lang, h.start, h.end),
                                  percent: h.percent,
                                })}
                              />
                            </View>
                            <Text variant="label" style={styles.historyPct}>
                              {h.percent}%
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}

                  <Button
                    testID="delete-goal"
                    label={t('goals.delete')}
                    variant="destructive"
                    icon="trash"
                    onPress={() => setConfirmDelete(true)}
                    fullWidth
                  />

                  <ConfirmDialog
                    visible={confirmDelete}
                    title={t('goals.deleteTitle', { title: goal.title })}
                    body={t('goals.deleteBody', { count: detail.linkedIds.length })}
                    actions={[
                      {
                        label: t('goals.delete'),
                        variant: 'destructive',
                        testID: 'confirm-delete-goal',
                        onPress: () => {
                          setConfirmDelete(false);
                          if (!ctx) return;
                          scheduleDelete(
                            {
                              label: goal.title,
                              kind: 'goal',
                              hide: { goalId: goal.id },
                              run: () => deleteGoal(ctx, goal.id),
                            },
                            fail,
                          );
                          back();
                        },
                      },
                    ]}
                    onCancel={() => setConfirmDelete(false)}
                    cancelLabel={t('editor.cancel')}
                  />
                  <TaskPickerSheet
                    visible={picker}
                    selected={detail.linkedIds}
                    goalId={goal.id}
                    onClose={() => setPicker(false)}
                    onDone={(ids) => {
                      setPicker(false);
                      if (!ctx) return;
                      const added = ids.filter((id) => !detail.linkedIds.includes(id));
                      const removed = detail.linkedIds.filter((id) => !ids.includes(id));
                      void (async () => {
                        if (added.length) await linkTasks(ctx, goal.id, added);
                        for (const id of removed) await unlinkTask(ctx, goal.id, id);
                      })().catch(fail);
                    }}
                  />
                </View>
              );
            }}
          </AsyncContent>
        </ScrollView>
      </View>
    </TaskActionsProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingBottom: space.xs,
  },
  iconButton: { width: sizes.touch, height: sizes.touch, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs },
  stack: { gap: space.lg },
  titleBlock: { gap: space.xxs },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap', padding: space.lg },
  heroText: { flex: 1, minWidth: 140, gap: space.xxs, alignItems: 'flex-start' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  pct: { fontFamily: fontFamilies.displayMedium, fontSize: 40, lineHeight: 44, fontVariant: ['tabular-nums'] },
  pctSign: { fontFamily: fontFamilies.displayMedium, fontSize: 20, lineHeight: 24 },
  section: { gap: space.xs },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  remCard: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  historyLabel: { width: 150 },
  historyPct: { width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
