import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getTaskDetail, type TaskDetail } from '../../data/queries/agenda';
import { useQuery } from '../../data/useQuery';
import { localDateOf } from '../../domain/localDate';
import { shortDate } from '../../i18n/dates';
import { clockParts, formatMinutes, noonOf } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { CategoryDot, Checkbox } from '../../ui/Checkbox';
import { Icon } from '../../ui/Icon';
import { StackScreen } from '../../ui/StackScreen';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { radii, sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';
import { useDataContext } from '../session/SessionProvider';
import { isHidden, usePendingDeletes } from './pendingDeletes';
import { repeatSummary } from './repeatSummary';
import { TaskActionsProvider, useTaskActions } from './TaskActions';
import { UndoSnackbar } from './UndoSnackbar';

function Chip({ label, dot }: { label: string; dot?: TaskDetail['item']['categoryColor'] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: colors.chip }]}>
      {dot ? <CategoryDot color={dot} size={8} /> : null}
      <Text variant="label" color={colors.text}>
        {label}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Body({ detail, today }: { detail: TaskDetail; today: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const actions = useTaskActions();
  const [goalFocused, goalFocus] = useFocusRing();
  const lang = i18n.language;
  const { item, rule, goal, template } = detail;
  const clock = item.startTime ? clockParts(item.startTime, lang) : null;
  const overdue = !item.done && !template && !!item.date && item.date < today && !item.recurring;
  const priority =
    item.priority >= 3
      ? t('editor.priority_high')
      : item.priority === 2
        ? t('editor.priority_medium')
        : item.priority === 1
          ? t('editor.priority_low')
          : null;
  const dateLine = [
    item.date ? shortDate(noonOf(item.date), lang) : t('editor.noDate'),
    item.durationMin ? formatMinutes(item.durationMin, lang) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.stack} testID="task-detail">
      <View style={styles.head}>
        <Text
          variant="display"
          color={item.done ? colors.textSecondary : colors.text}
          style={styles.tabular}
          testID="detail-time"
          accessibilityLabel={
            item.startTime ? `${clock?.main ?? ''}${clock?.suffix ? ` ${clock.suffix}` : ''}` : t('tasks.anytime')
          }
        >
          {clock ? clock.main : t('tasks.anytime')}
          {clock?.suffix ? (
            <Text variant="title2" color={colors.textSecondary}>
              {` ${clock.suffix}`}
            </Text>
          ) : null}
        </Text>
        <Text variant="body" color={overdue ? colors.danger : colors.textSecondary} testID="detail-date">
          {overdue ? `${t('today.overdue')} · ${dateLine}` : dateLine}
        </Text>
      </View>

      <Text
        variant="title1"
        accessibilityRole="header"
        color={item.done ? colors.textSecondary : colors.text}
        style={item.done ? styles.done : null}
      >
        {item.title}
      </Text>

      {item.categoryName || priority || item.done ? (
        <View style={styles.chips}>
          {item.done ? <Chip label={t('today.done')} /> : null}
          {item.categoryName ? <Chip label={item.categoryName} dot={item.categoryColor} /> : null}
          {priority ? <Chip label={`${t('editor.priority')}: ${priority}`} /> : null}
        </View>
      ) : null}

      {template ? (
        <Text variant="bodySm" color={colors.textSecondary}>
          {t('details.templateNote')}
        </Text>
      ) : (
        <Button
          testID="detail-toggle"
          label={item.done ? t('tasks.menuReopen') : t('tasks.menuDone')}
          icon="check"
          variant={item.done ? 'secondary' : 'primary'}
          fullWidth
          onPress={() => actions.toggle(item, !item.done)}
        />
      )}

      {rule ? (
        <Section title={t('repeat.title')}>
          <Card style={styles.line}>
            <Icon name="repeat" size={20} color={colors.textSecondary} />
            <View style={styles.flex}>
              <Text variant="body" testID="detail-repeat">
                {repeatSummary(t, lang, rule)}
              </Text>
              {template ? null : (
                <Text variant="bodySm" color={colors.textSecondary}>
                  {t('details.seriesNote')}
                </Text>
              )}
            </View>
          </Card>
        </Section>
      ) : null}

      {item.subtaskItems.length ? (
        <Section title={`${t('editor.subtasks')} · ${item.subtasks.done}/${item.subtasks.total}`}>
          <Card style={styles.subs}>
            {item.subtaskItems.map((s) => (
              <View key={s.id} style={styles.subRow}>
                <Checkbox
                  checked={s.done}
                  onChange={(done) => actions.tickSubtask(item, s.id, done)}
                  accessibilityLabel={t(s.done ? 'tasks.markOpen' : 'tasks.markDone', { title: s.title })}
                  testID={`detail-sub-${s.id}`}
                />
                <Text
                  variant="body"
                  color={s.done ? colors.textSecondary : colors.text}
                  style={[styles.flex, s.done ? styles.done : null]}
                >
                  {s.title}
                </Text>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {item.notes ? (
        <Section title={t('editor.notes')}>
          <Card>
            <Text variant="body" testID="detail-notes">
              {item.notes}
            </Text>
          </Card>
        </Section>
      ) : null}

      {goal ? (
        <Section title={t('editor.goal')}>
          <Pressable
            {...goalFocus}
            testID="detail-goal"
            onPress={() => router.push({ pathname: '/goal/[id]', params: { id: goal.id } })}
            accessibilityRole="button"
            accessibilityLabel={t('tasks.goalLabel', { title: goal.title })}
            accessibilityHint={t('details.goalHint')}
            style={[styles.focusBox, { borderColor: goalFocused ? colors.focus : 'transparent' }]}
          >
            <Card style={styles.line}>
              <Icon name="goals" size={20} color={colors.accentText} />
              <Text variant="title3" style={styles.flex}>
                {goal.title}
              </Text>
              <Icon name="chevronRight" size={20} color={colors.textSecondary} />
            </Card>
          </Pressable>
        </Section>
      ) : null}

      <Section title={t('reminders.title')}>
        <Card style={styles.line}>
          <Icon name="bell" size={20} color={colors.textSecondary} />
          <Text variant="bodySm" color={colors.textSecondary} style={styles.flex} testID="detail-reminders">
            {t('details.remindersSoon')}
          </Text>
        </Card>
      </Section>

      <View style={styles.actions}>
        {template ? null : (
          <Button
            testID="detail-reschedule"
            label={t('details.reschedule')}
            variant="secondary"
            icon="calendar"
            fullWidth
            onPress={() => actions.quickEdit(item)}
          />
        )}
        <Button
          testID="detail-delete"
          label={t('tasks.delete')}
          variant="destructive"
          icon="trash"
          fullWidth
          onPress={() => actions.remove(item)}
        />
      </View>
    </View>
  );
}

/**
 * Task details (read view): start time and date, status, category and priority, repeat summary, subtasks that can
 * be ticked, notes, the linked goal and a reminders placeholder, with Edit, Mark done, Reschedule (quick edit) and
 * Delete. Reached by tapping a task row or a calendar block; the editor and the quick-edit sheet open from here.
 */
export function TaskDetailScreen({
  taskId,
  occurrenceId = null,
  now = new Date(),
}: {
  taskId: string;
  occurrenceId?: string | null;
  now?: Date;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ctx = useDataContext();
  const today = localDateOf(now);
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback(
    (db: Parameters<typeof getTaskDetail>[0]) => getTaskDetail(db, ownerId, taskId, occurrenceId),
    [ownerId, taskId, occurrenceId],
  );
  const state = useQuery(query);
  const pending = usePendingDeletes((s) => s.pending);
  const detail = state.status === 'success' ? state.data : null;
  const loaded = state.status === 'success';

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  // Leave once the task is deleted here (the undo bar follows to the previous screen), or when an edit made this
  // occurrence part of another series ("this and following").
  const seen = useRef(false);
  const left = useRef(false);
  const gone = !!detail && isHidden(detail.item, pending);
  const replaced = loaded && !detail;
  useEffect(() => {
    if (detail) seen.current = true;
    if (left.current || !(gone || (replaced && seen.current))) return;
    left.current = true;
    back();
  }, [detail, gone, replaced, back]);

  const edit = () =>
    router.push({ pathname: '/task/[id]', params: occurrenceId ? { id: taskId, occ: occurrenceId } : { id: taskId } });

  return (
    <TaskActionsProvider now={now} onError={state.reload}>
      <StackScreen
        testID="screen-task-detail"
        backLabel={t('details.back')}
        onBack={back}
        action={
          detail ? (
            <Button
              testID="detail-edit"
              label={t('details.edit')}
              variant="secondary"
              size="compact"
              icon="edit"
              onPress={edit}
            />
          ) : null
        }
        footer={<UndoSnackbar bottom={insets.bottom + space.lg} />}
      >
        <AsyncContent
          state={state}
          onRetry={state.reload}
          isEmpty={(d) => d === null}
          empty={
            <EmptyState
              icon="today"
              title={t('editor.notFound')}
              body={t('details.notFoundBody')}
              action={{ label: t('details.back'), onPress: back }}
            />
          }
        >
          {(d) => (d ? <Body detail={d} today={today} /> : null)}
        </AsyncContent>
      </StackScreen>
    </TaskActionsProvider>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1, minWidth: 0 },
  head: { gap: space.xxs },
  tabular: { fontVariant: ['tabular-nums'] },
  done: { textDecorationLine: 'line-through' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
    borderRadius: radii.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  section: { gap: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  subs: { paddingVertical: space.xs, paddingLeft: space.xs, gap: 0 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, minHeight: sizes.touch },
  focusBox: { borderWidth: 2, borderRadius: radii.card + 2 },
  actions: { gap: space.sm, marginTop: space.xs },
});
