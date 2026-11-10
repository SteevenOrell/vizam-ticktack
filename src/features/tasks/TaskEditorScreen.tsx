import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ZodError } from 'zod';

import { getCategoryOptions, type CategoryOption } from '../../data/queries/agenda';
import {
  createTask,
  deleteTask,
  emptyDraft,
  loadTaskForm,
  previewOrphans,
  taskDraftSchema,
  updateTask,
  type TaskDraft,
  type TaskForm,
} from '../../data/tasks';
import { useQuery } from '../../data/useQuery';
import { addDays, localDateOf, type LocalDate } from '../../domain/localDate';
import type { EditScope } from '../../domain/recurrence/seriesEdit';
import { defaultWeekStartsOn, shortDate } from '../../i18n/dates';
import { noonOf } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { ConfirmDialog, type DialogAction } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { ErrorState, Skeleton } from '../../ui/states';
import { Stepper } from '../../ui/Stepper';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { radii, sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext } from '../session/SessionProvider';
import { CategoryField, DurationSelect, GoalField, TimeSelect } from './fields';
import { RepeatEditor } from './RepeatEditor';

const TIME_RE = /^([01]?\d|2[0-3])[:h.]?([0-5]\d)$/;

/** "9:30", "0930", "9h30" -> "09:30"; empty -> null; anything else -> undefined (invalid). */
export function parseTimeInput(text: string): string | null | undefined {
  const s = text.trim();
  if (!s) return null;
  const m = TIME_RE.exec(s);
  if (!m) return undefined;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

type Errors = Partial<Record<'title' | 'date' | 'startTime' | 'repeat' | 'notes' | 'categoryName' | 'form', string>>;

function errorsFrom(error: ZodError, t: (k: string) => string): Errors {
  const out: Errors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form') as keyof Errors;
    if (out[field]) continue;
    const known = [
      'titleRequired',
      'titleTooLong',
      'notesTooLong',
      'dateRequiredForRepeat',
      'dateRequiredForTime',
      'endBeforeStart',
      'categoryTooLong',
    ];
    const key = known.includes(issue.message)
      ? issue.message
      : field === 'repeat'
        ? 'repeatInvalid'
        : field === 'title'
          ? 'titleRequired'
          : 'invalid';
    out[field in { title: 1, date: 1, startTime: 1, repeat: 1, notes: 1, categoryName: 1 } ? field : 'form'] = t(
      `editor.errors.${key}`,
    );
  }
  return out;
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

export function TaskEditorScreen({
  taskId,
  occurrenceId,
  initialDate,
  now = new Date(),
}: {
  taskId?: string;
  occurrenceId?: string | null;
  initialDate?: LocalDate | null;
  now?: Date;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ctx = useDataContext();
  const lang = i18n.language;
  const today = localDateOf(now);
  const weekStartsOn = defaultWeekStartsOn(lang);

  const [form, setForm] = useState<TaskForm | null | 'missing'>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(taskId ? null : emptyDraft(initialDate ?? today));
  const [newSubtask, setNewSubtask] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: 'save' | 'delete'; orphans: number }>(null);
  const [loadError, setLoadError] = useState(false);

  const categoriesQuery = useCallback(
    (db: Parameters<typeof getCategoryOptions>[0]) => getCategoryOptions(db, ctx?.ownerId ?? 'local'),
    [ctx?.ownerId],
  );
  const categories = useQuery(categoriesQuery);
  const categoryList: CategoryOption[] = categories.status === 'success' ? categories.data : [];

  useEffect(() => {
    if (!taskId || !ctx) return;
    let cancelled = false;
    loadTaskForm(ctx, taskId, occurrenceId).then(
      (f) => {
        if (cancelled) return;
        setForm(f ?? 'missing');
        if (f) {
          setDraft(f.draft);
        }
      },
      () => !cancelled && setLoadError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [taskId, occurrenceId, ctx]);

  const isSeries = !!(form && form !== 'missing' && form.rule);
  const update = useCallback((patch: Partial<TaskDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d)), []);

  const finalDraft = useCallback((): TaskDraft | null => {
    if (!draft) return null;
    const candidate = { ...draft, startTime: draft.date ? draft.startTime : null };
    const parsed = taskDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(errorsFrom(parsed.error, (k) => t(k as never)));
      return null;
    }
    setErrors({});
    return candidate;
  }, [draft, t]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setSaving(true);
      try {
        await fn();
        close();
      } catch (error) {
        console.warn('Task save failed', error instanceof Error ? error.name : 'unknown');
        setErrors({ form: t('editor.errors.saveFailed') });
      } finally {
        setSaving(false);
      }
    },
    [close, t],
  );

  const onSave = useCallback(async () => {
    if (!ctx) return;
    const d = finalDraft();
    if (!d) return;
    if (!taskId) return run(() => createTask(ctx, d));
    if (isSeries && occurrenceId) {
      const orphans = d.repeat ? (await previewOrphans(ctx, taskId, d.repeat)).length : 0;
      setDialog({ kind: 'save', orphans });
      return;
    }
    return run(() => updateTask(ctx, taskId, d, { scope: 'all' }));
  }, [ctx, finalDraft, isSeries, occurrenceId, run, taskId]);

  const saveWithScope = (scope: EditScope) => {
    const d = finalDraft();
    setDialog(null);
    if (!ctx || !taskId || !d) return;
    void run(() => updateTask(ctx, taskId, d, { scope, occurrenceId }));
  };
  const deleteWithScope = (scope: EditScope) => {
    setDialog(null);
    if (!ctx || !taskId) return;
    void run(() => deleteTask(ctx, { taskId, occurrenceId }, scope));
  };

  const dialogActions: DialogAction[] = useMemo(() => {
    if (!dialog) return [];
    const act = dialog.kind === 'save' ? saveWithScope : deleteWithScope;
    const destructive = dialog.kind === 'delete';
    if (!isSeries) {
      return [
        { label: t('editor.delete'), variant: 'destructive', onPress: () => act('all'), testID: 'confirm-delete' },
      ];
    }
    return [
      ...(occurrenceId
        ? [{ label: t('editor.scopeThis'), onPress: () => act('this'), testID: 'scope-this' } as DialogAction]
        : []),
      ...(occurrenceId
        ? [
            {
              label: t('editor.scopeFollowing'),
              onPress: () => act('following'),
              testID: 'scope-following',
            } as DialogAction,
          ]
        : []),
      {
        label: t('editor.scopeAll'),
        onPress: () => act('all'),
        variant: destructive ? 'destructive' : 'primary',
        testID: 'scope-all',
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, isSeries, occurrenceId, t, draft]);

  if (taskId && (form === null || draft === null) && !loadError) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg }]}>
        <Skeleton lines={5} />
      </View>
    );
  }
  if (loadError || form === 'missing' || !draft) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg }]}>
        <ErrorState onRetry={close} message={t('editor.notFound')} />
      </View>
    );
  }

  const title = taskId ? t('editor.editTitle') : t('editor.newTitle');
  const dateLabel = draft.date ? shortDate(noonOf(draft.date), lang) : t('editor.noDate');

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} testID="screen-task-editor">
      <View style={[styles.bar, { paddingTop: insets.top + space.md }]}>
        <Text variant="title1" accessibilityRole="header" style={styles.flex}>
          {title}
        </Text>
        <Button label={t('modal.close')} variant="secondary" size="compact" icon="close" onPress={close} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.huge }]}>
        {isSeries && occurrenceId ? (
          <View style={[styles.banner, { backgroundColor: colors.surface }]}>
            <Icon name="repeat" size={18} color={colors.accentText} />
            <Text variant="bodySm" color={colors.textSecondary} style={styles.flex}>
              {t('editor.seriesNote')}
            </Text>
          </View>
        ) : null}

        <TextField
          testID="field-title"
          label={t('editor.titleLabel')}
          placeholder={t('editor.titlePlaceholder')}
          value={draft.title}
          onChangeText={(title) => update({ title })}
          error={errors.title}
          large
          maxLength={200}
          returnKeyType="done"
        />

        <Section title={t('editor.date')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('editor.date')} style={styles.pills}>
            <Pill
              label={t('editor.noDate')}
              selected={draft.date === null}
              onPress={() => update({ date: null, repeat: null, startTime: null })}
            />
            <Pill label={t('editor.today')} selected={draft.date === today} onPress={() => update({ date: today })} />
            <Pill
              label={t('editor.tomorrow')}
              selected={draft.date === addDays(today, 1)}
              onPress={() => update({ date: addDays(today, 1) })}
            />
          </View>
          {draft.date ? (
            <Stepper
              testID="field-date"
              label={t('editor.date')}
              value={dateLabel}
              previousLabel={t('dates.previousDay')}
              nextLabel={t('dates.nextDay')}
              onPrevious={() => update({ date: addDays(draft.date as string, -1) })}
              onNext={() => update({ date: addDays(draft.date as string, 1) })}
            />
          ) : null}
          {errors.date ? (
            <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
              {errors.date}
            </Text>
          ) : null}
        </Section>

        <View style={styles.timeRow}>
          <View style={styles.timeCell}>
            <TimeSelect
              value={draft.date ? draft.startTime : null}
              onChange={(startTime) => update({ startTime })}
              now={now}
              error={errors.startTime}
            />
          </View>
          <View style={styles.timeCell}>
            <DurationSelect value={draft.durationMin} onChange={(durationMin) => update({ durationMin })} />
          </View>
        </View>

        <Section title={t('editor.priority')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('editor.priority')} style={styles.pills}>
            {(['none', 'low', 'medium', 'high'] as const).map((p, i) => (
              <Pill
                key={p}
                label={t(`editor.priority_${p}`)}
                selected={draft.priority === i}
                onPress={() => update({ priority: i })}
              />
            ))}
          </View>
        </Section>

        <CategoryField
          value={draft.categoryName ?? ''}
          onChange={(categoryName) => update({ categoryName })}
          categories={categoryList}
          error={errors.categoryName}
        />

        <GoalField
          value={draft.goalId ?? null}
          onChange={(goalId) => update({ goalId })}
          newTitle={draft.newGoalTitle ?? null}
          onNewTitle={(newGoalTitle) => update({ newGoalTitle })}
        />

        <Section title={t('repeat.title')}>
          <RepeatEditor
            value={draft.repeat}
            onChange={(repeat) => update({ repeat })}
            startDate={draft.date}
            weekStartsOn={weekStartsOn}
            error={errors.repeat}
          />
        </Section>

        <TextField
          testID="field-notes"
          label={t('editor.notes')}
          placeholder={t('editor.notesPlaceholder')}
          value={draft.notes ?? ''}
          onChangeText={(notes) => update({ notes: notes.length ? notes : null })}
          error={errors.notes}
          multiline
          maxLength={5000}
        />

        <Section title={t('editor.subtasks')}>
          {draft.subtasks.map((s, i) => (
            <View key={s.id ?? `new-${i}`} style={[styles.subtask, { backgroundColor: colors.surface }]}>
              <Checkbox
                checked={s.done}
                accessibilityLabel={t(s.done ? 'tasks.markOpen' : 'tasks.markDone', { title: s.title })}
                onChange={(done) => update({ subtasks: draft.subtasks.map((x, j) => (j === i ? { ...x, done } : x)) })}
              />
              <Text variant="body" style={styles.flex}>
                {s.title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('editor.removeSubtask', { title: s.title })}
                onPress={() => update({ subtasks: draft.subtasks.filter((_, j) => j !== i) })}
                style={styles.iconButton}
              >
                <Icon name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
          <View style={styles.addRow}>
            <View style={styles.flex}>
              <TextField
                testID="field-subtask"
                label={t('editor.addSubtask')}
                placeholder={t('editor.subtaskPlaceholder')}
                value={newSubtask}
                onChangeText={setNewSubtask}
                maxLength={200}
                onSubmitEditing={() => {
                  if (!newSubtask.trim() || draft.subtasks.length >= 30) return;
                  update({ subtasks: [...draft.subtasks, { title: newSubtask.trim(), done: false }] });
                  setNewSubtask('');
                }}
              />
            </View>
            <Button
              label={t('editor.add')}
              variant="secondary"
              size="compact"
              icon="plus"
              disabled={!newSubtask.trim() || draft.subtasks.length >= 30}
              onPress={() => {
                update({ subtasks: [...draft.subtasks, { title: newSubtask.trim(), done: false }] });
                setNewSubtask('');
              }}
            />
          </View>
        </Section>

        {errors.form ? (
          <Text variant="body" color={colors.danger} accessibilityLiveRegion="polite">
            {errors.form}
          </Text>
        ) : null}

        <Button
          testID="save-task"
          label={saving ? t('editor.saving') : t('editor.save')}
          onPress={() => void onSave()}
          disabled={saving || !ctx}
          fullWidth
        />
        {taskId ? (
          <Button
            testID="delete-task"
            label={t('editor.delete')}
            variant="destructive"
            icon="trash"
            onPress={() => setDialog({ kind: 'delete', orphans: 0 })}
            disabled={saving}
            fullWidth
          />
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={dialog !== null}
        title={
          dialog?.kind === 'delete'
            ? isSeries
              ? t('editor.deleteSeriesTitle')
              : t('editor.deleteTitle')
            : t('editor.saveSeriesTitle')
        }
        body={
          dialog?.kind === 'save' && dialog.orphans > 0
            ? t('editor.orphans', { count: dialog.orphans })
            : dialog?.kind === 'delete' && !isSeries
              ? t('editor.deleteBody')
              : undefined
        }
        actions={dialogActions}
        onCancel={() => setDialog(null)}
        cancelLabel={t('editor.cancel')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  content: { paddingHorizontal: space.lg, gap: space.lg },
  section: { gap: space.xs },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  timeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexWrap: 'wrap' },
  timeCell: { flex: 1, minWidth: 140 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radii.card, padding: space.sm },
  subtask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radii.input,
    paddingRight: space.xxs,
  },
  iconButton: { width: sizes.touch, height: sizes.touch, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
});
