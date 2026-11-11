import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ZodError } from 'zod';

import {
  createGoal,
  getLinkableTasks,
  GoalNeedsTaskError,
  goalDraftSchema,
  loadGoalForm,
  updateGoal,
  type GoalDraft,
  type NewGoalTask,
} from '../../data/goals';
import { useQuery } from '../../data/useQuery';
import { defaultPeriodStart, GOAL_PERIODS, periodContaining, type GoalPeriod } from '../../domain/goals';
import { addDays, addMonthsClamped, localDateOf, type LocalDate } from '../../domain/localDate';
import { categoryColorSchema, DEFAULT_GOAL_REMINDERS, type CategoryColor } from '../../domain/models';
import { defaultWeekStartsOn, shortDate } from '../../i18n/dates';
import { formatClock, formatMinutes, noonOf } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { columnStyle } from '../../ui/Centered';
import { CategoryDot } from '../../ui/Checkbox';
import { Icon } from '../../ui/Icon';
import { KeyboardAwareScrollView, KeyboardSafeView, RevealTarget } from '../../ui/keyboard';
import { Pill } from '../../ui/Pill';
import { ErrorState, Skeleton } from '../../ui/states';
import { Stepper } from '../../ui/Stepper';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { radii, sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext } from '../session/SessionProvider';
import { DurationSelect, TimeSelect } from '../tasks/fields';
import { periodLabel, rangeLabel } from './goalFormat';
import { MilestonesEditor } from './MilestonesEditor';
import { RemindersEditor } from './RemindersEditor';
import { TaskPickerSheet } from './TaskPickerSheet';

type Errors = Partial<
  Record<'title' | 'description' | 'dueDate' | 'startDate' | 'tasks' | 'newTask' | 'milestones' | 'form', string>
>;

const COLORS = categoryColorSchema.options;

export function emptyGoalDraft(today: LocalDate): GoalDraft {
  return {
    title: '',
    description: null,
    period: 'once',
    startDate: null,
    dueDate: addMonthsClamped(today, 1),
    color: null,
    reminders: DEFAULT_GOAL_REMINDERS,
    linkTaskIds: [],
    newTasks: [],
    milestones: [],
  };
}

function Section({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section} testID={testID}>
      <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function errorsFrom(error: ZodError, t: (k: string) => string): Errors {
  const out: Errors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form');
    const key: keyof Errors =
      field === 'title' ||
      field === 'description' ||
      field === 'dueDate' ||
      field === 'startDate' ||
      field === 'tasks' ||
      field === 'milestones'
        ? field
        : field === 'newTasks'
          ? 'newTask'
          : 'form';
    if (out[key]) continue;
    const known = [
      'milestoneTitleRequired',
      'milestoneTitleTooLong',
      'titleRequired',
      'titleTooLong',
      'descriptionTooLong',
      'dueRequired',
      'startRequired',
      'dueBeforeStart',
      'needsTask',
    ];
    out[key] = t(`goals.errors.${known.includes(issue.message) ? issue.message : 'invalid'}`);
  }
  return out;
}

function TaskLine({
  title,
  meta,
  onRemove,
  removeLabel,
  testID,
}: {
  title: string;
  meta?: string;
  onRemove: () => void;
  removeLabel: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.taskLine, { backgroundColor: colors.surface }]} testID={testID}>
      <Icon name="check" size={16} color={colors.accentText} />
      <View style={styles.flex}>
        <Text variant="body" weight={500} numberOfLines={2}>
          {title}
        </Text>
        {meta ? (
          <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        style={styles.iconButton}
        hitSlop={4}
      >
        <Icon name="close" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

/** Create or edit a goal: fields, period and due date, linked / new tasks (at least one), colour and reminders. */
export function GoalEditorScreen({ goalId, now = new Date() }: { goalId?: string; now?: Date }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ctx = useDataContext();
  const lang = i18n.language;
  const today = localDateOf(now);
  const weekStartsOn = defaultWeekStartsOn(lang);

  const [draft, setDraft] = useState<GoalDraft | null>(goalId ? null : emptyGoalDraft(today));
  const [missing, setMissing] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const [newTask, setNewTask] = useState<NewGoalTask>({ title: '', date: null, startTime: null, durationMin: null });

  useEffect(() => {
    if (!goalId || !ctx) return;
    let cancelled = false;
    loadGoalForm(ctx, goalId).then(
      (f) => {
        if (cancelled) return;
        if (f) setDraft(f.draft);
        else setMissing(true);
      },
      () => !cancelled && setMissing(true),
    );
    return () => {
      cancelled = true;
    };
  }, [goalId, ctx]);

  const tasksQuery = useCallback(
    (db: Parameters<typeof getLinkableTasks>[0]) => getLinkableTasks(db, ctx?.ownerId ?? 'local'),
    [ctx?.ownerId],
  );
  const tasks = useQuery(tasksQuery);
  const taskById = useMemo(
    () => new Map((tasks.status === 'success' ? tasks.data : []).map((task) => [task.id, task])),
    [tasks],
  );

  const update = useCallback((patch: Partial<GoalDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d)), []);
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/goals');
  }, [router]);

  if (goalId && !draft && !missing) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg }]}>
        <Skeleton lines={5} />
      </View>
    );
  }
  if (missing || !draft) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg }]}>
        <ErrorState onRetry={close} message={t('goals.notFound')} />
      </View>
    );
  }

  const taskCount = new Set(draft.linkTaskIds).size + draft.newTasks.length;
  const canSave = taskCount > 0 && !saving && !!ctx;

  const setPeriod = (period: GoalPeriod) =>
    update(
      period === 'once'
        ? { period, startDate: null, dueDate: draft.dueDate ?? addMonthsClamped(today, 1) }
        : { period, startDate: defaultPeriodStart(period, today, weekStartsOn), dueDate: null },
    );

  const addNewTask = () => {
    const title = newTask.title.trim();
    if (!title) {
      setErrors((e) => ({ ...e, newTask: t('goals.errors.taskTitleRequired') }));
      return;
    }
    update({
      newTasks: [...draft.newTasks, { ...newTask, title, startTime: newTask.date ? newTask.startTime : null }],
    });
    setNewTask({ title: '', date: null, startTime: null, durationMin: null });
    setErrors((e) => ({ ...e, newTask: undefined, tasks: undefined }));
  };

  const onSave = async () => {
    if (!ctx) return;
    const parsed = goalDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(errorsFrom(parsed.error, (k) => t(k as never)));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (goalId) {
        await updateGoal(ctx, goalId, draft);
        close();
      } else {
        const goal = await createGoal(ctx, draft);
        router.replace({ pathname: '/goal/[id]', params: { id: goal.id } });
      }
    } catch (error) {
      console.warn('Goal save failed', error instanceof Error ? error.name : 'unknown');
      setErrors({
        form: t(error instanceof GoalNeedsTaskError ? 'goals.errors.needsTask' : 'goals.errors.saveFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const period = periodContaining(draft.period, draft.startDate ?? today, today);
  const taskMeta = (date: string | null, time: string | null, duration: number | null) =>
    [
      date ? shortDate(noonOf(date), lang) : t('editor.noDate'),
      date && time ? formatClock(time, lang) : null,
      duration ? formatMinutes(duration, lang) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <KeyboardSafeView style={{ backgroundColor: colors.bg }} testID="screen-goal-editor">
      <View style={[styles.bar, { paddingTop: insets.top + space.md }]}>
        <Text variant="title1" accessibilityRole="header" style={styles.flex}>
          {goalId ? t('goals.editTitle') : t('goals.newTitle')}
        </Text>
        <Button label={t('modal.close')} variant="secondary" size="compact" icon="close" onPress={close} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <TextField
          testID="goal-title"
          label={t('goals.titleLabel')}
          placeholder={t('goals.titlePlaceholder')}
          value={draft.title}
          onChangeText={(title) => update({ title })}
          error={errors.title}
          large
          maxLength={120}
        />
        <TextField
          testID="goal-description"
          label={t('goals.descriptionLabel')}
          placeholder={t('goals.descriptionPlaceholder')}
          value={draft.description ?? ''}
          onChangeText={(d) => update({ description: d.length ? d : null })}
          error={errors.description}
          multiline
          maxLength={2000}
        />

        <Section title={t('goals.periodLabel')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('goals.periodLabel')} style={styles.pills}>
            {GOAL_PERIODS.map((p) => (
              <Pill
                key={p}
                role="radio"
                label={periodLabel(t, p)}
                selected={draft.period === p}
                onPress={() => setPeriod(p)}
                testID={`goal-period-${p}`}
              />
            ))}
          </View>
        </Section>

        {draft.period === 'once' ? (
          <Section title={t('goals.dueDate')} testID="goal-due-section">
            <View style={styles.pills}>
              <Pill
                label={t('goals.inWeek')}
                selected={draft.dueDate === addDays(today, 7)}
                onPress={() => update({ dueDate: addDays(today, 7) })}
              />
              <Pill
                label={t('goals.inMonth')}
                selected={draft.dueDate === addMonthsClamped(today, 1)}
                onPress={() => update({ dueDate: addMonthsClamped(today, 1) })}
              />
              <Pill
                label={t('goals.inThreeMonths')}
                selected={draft.dueDate === addMonthsClamped(today, 3)}
                onPress={() => update({ dueDate: addMonthsClamped(today, 3) })}
              />
            </View>
            <Stepper
              testID="goal-due"
              label={t('goals.dueDate')}
              value={draft.dueDate ? shortDate(noonOf(draft.dueDate), lang) : t('goals.noDueDate')}
              previousLabel={t('dates.previousDay')}
              nextLabel={t('dates.nextDay')}
              onPrevious={() => update({ dueDate: addDays(draft.dueDate ?? today, -1) })}
              onNext={() => update({ dueDate: addDays(draft.dueDate ?? today, 1) })}
            />
            {errors.dueDate ? (
              <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
                {errors.dueDate}
              </Text>
            ) : null}
          </Section>
        ) : (
          <Section title={t('goals.startDate')} testID="goal-start-section">
            <Stepper
              testID="goal-start"
              label={t('goals.startDate')}
              value={draft.startDate ? shortDate(noonOf(draft.startDate), lang) : '—'}
              previousLabel={t('dates.previousDay')}
              nextLabel={t('dates.nextDay')}
              onPrevious={() => update({ startDate: addDays(draft.startDate ?? today, -1) })}
              onNext={() => update({ startDate: addDays(draft.startDate ?? today, 1) })}
            />
            {period ? (
              <Text variant="caption" color={colors.textSecondary} testID="goal-current-period">
                {t('goals.currentPeriod', { range: rangeLabel(lang, period.start, period.end) })}
              </Text>
            ) : null}
            {errors.startDate ? (
              <Text variant="caption" color={colors.danger}>
                {errors.startDate}
              </Text>
            ) : null}
          </Section>
        )}

        <Section title={t('goals.colour')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('goals.colour')} style={styles.pills}>
            <Pill
              role="radio"
              label={t('goals.noColour')}
              selected={draft.color === null}
              onPress={() => update({ color: null })}
            />
            {COLORS.map((c: CategoryColor) => (
              <Pressable
                key={c}
                onPress={() => update({ color: c })}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.color === c, checked: draft.color === c }}
                accessibilityLabel={t(`goals.colour_${c}`)}
                style={[styles.swatch, { borderColor: draft.color === c ? colors.text : 'transparent' }]}
              >
                <CategoryDot color={c} size={22} />
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title={t('goals.tasksCount', { count: taskCount })} testID="goal-tasks-section">
          {draft.linkTaskIds.map((id) => {
            const task = taskById.get(id);
            return (
              <TaskLine
                key={id}
                testID={`linked-${id}`}
                title={task?.title ?? '…'}
                meta={task ? taskMeta(task.date, task.start_time, null) : undefined}
                removeLabel={t('goals.unlinkTask', { title: task?.title ?? '' })}
                onRemove={() => update({ linkTaskIds: draft.linkTaskIds.filter((x) => x !== id) })}
              />
            );
          })}
          {draft.linkTaskIds.some((id) => taskById.get(id)?.recurring) ? (
            <Text variant="caption" color={colors.textSecondary} testID="goal-repeat-note">
              {t('goals.repeatEndNote')}
            </Text>
          ) : null}
          {draft.newTasks.map((n, i) => (
            <TaskLine
              key={`new-${i}`}
              testID={`new-task-${i}`}
              title={n.title}
              meta={`${t('goals.newTaskBadge')} · ${taskMeta(n.date, n.startTime, n.durationMin)}`}
              removeLabel={t('goals.unlinkTask', { title: n.title })}
              onRemove={() => update({ newTasks: draft.newTasks.filter((_, j) => j !== i) })}
            />
          ))}
          <Button
            testID="link-tasks"
            label={t('goals.linkExisting')}
            variant="secondary"
            icon="plus"
            onPress={() => setPicker(true)}
            fullWidth
          />

          <RevealTarget style={[styles.newTask, { borderColor: colors.border }]}>
            <Text variant="label" color={colors.textSecondary}>
              {t('goals.createTask')}
            </Text>
            <TextField
              testID="new-task-title"
              label={t('goals.newTaskTitle')}
              placeholder={t('goals.newTaskPlaceholder')}
              value={newTask.title}
              onChangeText={(title) => setNewTask((n) => ({ ...n, title }))}
              onSubmitEditing={addNewTask}
              error={errors.newTask}
              maxLength={200}
              returnKeyType="done"
            />
            <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={t('editor.date')}>
              <Pill
                role="radio"
                label={t('editor.noDate')}
                selected={newTask.date === null}
                onPress={() => setNewTask((n) => ({ ...n, date: null, startTime: null }))}
              />
              <Pill
                role="radio"
                label={t('editor.today')}
                selected={newTask.date === today}
                onPress={() => setNewTask((n) => ({ ...n, date: today }))}
              />
              <Pill
                role="radio"
                label={t('editor.tomorrow')}
                selected={newTask.date === addDays(today, 1)}
                onPress={() => setNewTask((n) => ({ ...n, date: addDays(today, 1) }))}
              />
            </View>
            {newTask.date ? (
              <Stepper
                testID="new-task-date"
                label={t('editor.date')}
                value={shortDate(noonOf(newTask.date), lang)}
                previousLabel={t('dates.previousDay')}
                nextLabel={t('dates.nextDay')}
                onPrevious={() => setNewTask((n) => ({ ...n, date: addDays(n.date ?? today, -1) }))}
                onNext={() => setNewTask((n) => ({ ...n, date: addDays(n.date ?? today, 1) }))}
              />
            ) : null}
            <View style={styles.timeRow}>
              {newTask.date ? (
                <View style={styles.timeCell}>
                  <TimeSelect
                    testID="new-task-time"
                    value={newTask.startTime}
                    onChange={(startTime) => setNewTask((n) => ({ ...n, startTime }))}
                    now={now}
                  />
                </View>
              ) : null}
              <View style={styles.timeCell}>
                <DurationSelect
                  testID="new-task-duration"
                  value={newTask.durationMin}
                  onChange={(durationMin) => setNewTask((n) => ({ ...n, durationMin }))}
                />
              </View>
            </View>
            <Button
              testID="add-new-task"
              label={t('goals.addTask')}
              variant="secondary"
              size="compact"
              icon="plus"
              onPress={addNewTask}
              disabled={!newTask.title.trim() || draft.newTasks.length >= 30}
            />
          </RevealTarget>
        </Section>

        <Section title={t('goals.milestonesTitle')} testID="goal-milestones-section">
          <MilestonesEditor
            value={draft.milestones ?? []}
            onChange={(milestones) => update({ milestones })}
            today={today}
            lang={lang}
            error={errors.milestones}
          />
        </Section>

        <Section title={t('reminders.title')}>
          <RemindersEditor
            value={draft.reminders}
            period={draft.period}
            onChange={(reminders) => update({ reminders })}
          />
        </Section>
      </KeyboardAwareScrollView>

      <View
        style={[
          styles.footer,
          { borderColor: colors.border, backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, space.sm) },
        ]}
      >
        {taskCount === 0 ? (
          <View style={styles.hint} testID="needs-task-hint">
            <Icon name="alert" size={16} color={colors.accentText} />
            <Text variant="bodySm" color={colors.textSecondary} style={styles.flex} accessibilityLiveRegion="polite">
              {t('goals.needsTaskHint')}
            </Text>
          </View>
        ) : null}
        {errors.form || errors.tasks ? (
          <Text variant="bodySm" color={colors.danger} accessibilityLiveRegion="polite" testID="goal-form-error">
            {errors.form ?? errors.tasks}
          </Text>
        ) : null}
        <Button
          testID="save-goal"
          label={saving ? t('editor.saving') : goalId ? t('goals.saveChanges') : t('goals.createGoal')}
          onPress={() => void onSave()}
          disabled={!canSave}
          accessibilityHint={taskCount === 0 ? t('goals.needsTaskHint') : undefined}
          fullWidth
        />
      </View>

      <TaskPickerSheet
        visible={picker}
        selected={draft.linkTaskIds}
        goalId={goalId}
        onClose={() => setPicker(false)}
        onDone={(ids) => {
          setPicker(false);
          update({ linkTaskIds: ids });
          if (ids.length) setErrors((e) => ({ ...e, tasks: undefined }));
        }}
      />
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  bar: {
    ...columnStyle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  content: { ...columnStyle, paddingHorizontal: space.lg, gap: space.lg, paddingBottom: space.xl },
  section: { gap: space.xs },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' },
  swatch: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: sizes.touch / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radii.input,
    paddingLeft: space.sm,
    minHeight: 52,
  },
  iconButton: { width: sizes.touch, height: sizes.touch, alignItems: 'center', justifyContent: 'center' },
  newTask: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: space.sm, gap: space.sm },
  timeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexWrap: 'wrap' },
  timeCell: { flex: 1, minWidth: 140 },
  footer: {
    ...columnStyle,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.xs,
  },
  hint: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
