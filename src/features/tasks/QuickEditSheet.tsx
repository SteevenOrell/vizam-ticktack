import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { GoalRepeatError } from '../../data/goalBase';
import { getCategoryOptions, type AgendaItem } from '../../data/queries/agenda';
import { loadTaskForm, taskDraftSchema, updateTask, type TaskForm } from '../../data/tasks';
import { useQuery } from '../../data/useQuery';
import { addDays, localDateOf } from '../../domain/localDate';
import type { EditScope } from '../../domain/recurrence/seriesEdit';
import { shortDate } from '../../i18n/dates';
import { noonOf } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Pill } from '../../ui/Pill';
import { Sheet } from '../../ui/Sheet';
import { Skeleton } from '../../ui/states';
import { Stepper } from '../../ui/Stepper';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext } from '../session/SessionProvider';
import { CategoryField, DurationSelect, TimeSelect } from './fields';

/**
 * Quick edit (from the row menu or a swipe): title, date, start time, duration and category. Saves through the
 * normal `updateTask` path (validation, outbox); an occurrence of a series asks "this / following / all".
 */
export function QuickEditSheet({
  item,
  now,
  onClose,
  onOpenFull,
}: {
  item: AgendaItem;
  now: Date;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const ctx = useDataContext();
  const lang = i18n.language;
  const today = localDateOf(now);
  const [form, setForm] = useState<TaskForm | null>(null);
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState<string | null>(item.date);
  const [startTime, setStartTime] = useState<string | null>(item.startTime);
  const [duration, setDuration] = useState<number | null>(item.durationMin);
  const [category, setCategory] = useState(item.categoryName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [askScope, setAskScope] = useState(false);

  const categoriesQuery = useCallback(
    (db: Parameters<typeof getCategoryOptions>[0]) => getCategoryOptions(db, ctx?.ownerId ?? 'local'),
    [ctx?.ownerId],
  );
  const categories = useQuery(categoriesQuery);

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void loadTaskForm(ctx, item.taskId, item.occurrenceId).then((f) => {
      if (cancelled) return;
      if (!f) {
        onClose();
        return;
      }
      setForm(f);
      setTitle(f.draft.title);
      setDate(f.draft.date);
      setStartTime(f.draft.startTime);
      setDuration(f.draft.durationMin);
      setCategory(f.draft.categoryName ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [ctx, item.taskId, item.occurrenceId, onClose]);

  const isSeries = !!form?.rule && !!item.occurrenceId;

  const draft = () => {
    if (!form) return null;
    const candidate = {
      ...form.draft,
      title,
      date,
      startTime: date ? startTime : null,
      durationMin: duration,
      categoryName: category,
    };
    const parsed = taskDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid';
      const known = [
        'titleRequired',
        'titleTooLong',
        'dateRequiredForRepeat',
        'dateRequiredForTime',
        'categoryTooLong',
        'repeatNeverInGoal',
      ];
      setError(t(`editor.errors.${known.includes(message) ? message : 'invalid'}` as never));
      return null;
    }
    setError(null);
    return candidate;
  };

  const save = async (scope: EditScope) => {
    const d = draft();
    if (!ctx || !d) return;
    setSaving(true);
    try {
      await updateTask(ctx, item.taskId, d, { scope, occurrenceId: item.occurrenceId });
      onClose();
    } catch (e) {
      console.warn('Quick edit failed', e instanceof Error ? e.name : 'unknown');
      // The sheet has no repeat controls: a goal-linked series that may not be saved as is points to the editor.
      setError(t(e instanceof GoalRepeatError ? `editor.errors.${e.issue}` : 'editor.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    if (!draft()) return;
    if (isSeries) setAskScope(true);
    else void save('all');
  };

  return (
    <Sheet
      visible
      title={t('tasks.quickEdit')}
      onClose={onClose}
      closeLabel={t('modal.close')}
      testID="quick-edit"
      scroll
      footer={
        <>
          {error ? (
            <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite" testID="quick-edit-error">
              {error}
            </Text>
          ) : null}
          <Button
            testID="quick-edit-save"
            label={saving ? t('editor.saving') : t('editor.save')}
            onPress={onSave}
            disabled={!form || saving}
            fullWidth
          />
          <Button
            testID="quick-edit-full"
            label={t('tasks.openEditor')}
            variant="ghost"
            onPress={onOpenFull}
            fullWidth
          />
        </>
      }
    >
      {form ? (
        <View style={styles.form}>
          <TextField
            testID="quick-title"
            label={t('editor.titleLabel')}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
          />
          <View style={styles.section}>
            <Text variant="label" color={colors.textSecondary}>
              {t('editor.date')}
            </Text>
            <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={t('editor.date')}>
              {form.rule ? null : (
                <Pill label={t('editor.noDate')} selected={date === null} onPress={() => setDate(null)} />
              )}
              <Pill label={t('editor.today')} selected={date === today} onPress={() => setDate(today)} />
              <Pill
                label={t('editor.tomorrow')}
                selected={date === addDays(today, 1)}
                onPress={() => setDate(addDays(today, 1))}
              />
            </View>
            {date ? (
              <Stepper
                testID="quick-date"
                label={t('editor.date')}
                value={shortDate(noonOf(date), lang)}
                previousLabel={t('dates.previousDay')}
                nextLabel={t('dates.nextDay')}
                onPrevious={() => setDate(addDays(date, -1))}
                onNext={() => setDate(addDays(date, 1))}
              />
            ) : null}
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <TimeSelect value={date ? startTime : null} onChange={setStartTime} now={now} testID="quick-time" />
            </View>
            <View style={styles.flex}>
              <DurationSelect value={duration} onChange={setDuration} testID="quick-duration" />
            </View>
          </View>
          <CategoryField
            value={category}
            onChange={setCategory}
            categories={categories.status === 'success' ? categories.data : []}
            testID="quick-category"
          />
        </View>
      ) : (
        <Skeleton lines={4} />
      )}
      <ConfirmDialog
        visible={askScope}
        title={t('editor.saveSeriesTitle')}
        actions={[
          { label: t('editor.scopeThis'), onPress: () => pick('this'), testID: 'quick-scope-this' },
          { label: t('editor.scopeFollowing'), onPress: () => pick('following'), testID: 'quick-scope-following' },
          { label: t('editor.scopeAll'), onPress: () => pick('all'), variant: 'primary', testID: 'quick-scope-all' },
        ]}
        onCancel={() => setAskScope(false)}
        cancelLabel={t('editor.cancel')}
      />
    </Sheet>
  );

  function pick(scope: EditScope) {
    setAskScope(false);
    void save(scope);
  }
}

const styles = StyleSheet.create({
  form: { gap: space.md, paddingBottom: space.sm },
  section: { gap: space.xs },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 140 },
});
