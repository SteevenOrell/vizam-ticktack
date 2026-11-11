import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ZodError } from 'zod';

import { moveItem } from '../../data/milestones';
import {
  createRoutine,
  deleteRoutine,
  emptyRoutineDraft,
  loadRoutineForm,
  PARTS_OF_DAY,
  ROUTINE_STEPS_MAX,
  routineDraftSchema,
  updateRoutine,
  type RoutineDraft,
  type RoutineStepDraft,
} from '../../data/routines';
import { localDateOf } from '../../domain/localDate';
import { defaultWeekStartsOn } from '../../i18n/dates';
import { Button } from '../../ui/Button';
import { columnStyle } from '../../ui/Centered';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { KeyboardAwareScrollView, KeyboardSafeView } from '../../ui/keyboard';
import { Pill } from '../../ui/Pill';
import { ErrorState, Skeleton } from '../../ui/states';
import { Stepper } from '../../ui/Stepper';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { radii, sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { ItemReminderField } from '../goals/ItemReminderField';
import { useDataContext } from '../session/SessionProvider';
import { scheduleDelete } from '../tasks/pendingDeletes';
import { RepeatEditor } from '../tasks/RepeatEditor';
import { TimeSelect } from '../tasks/fields';

type ErrorKey = 'title' | 'steps' | 'repeat' | 'form';
type Errors = Partial<Record<ErrorKey, string>>;

const KNOWN_ERRORS = ['titleRequired', 'titleTooLong', 'needsStep', 'stepTitleRequired', 'stepTitleTooLong'];

function errorsFrom(error: ZodError, t: (k: string) => string): Errors {
  const out: Errors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form');
    const key: ErrorKey =
      field === 'title' ? 'title' : field === 'steps' ? 'steps' : field === 'repeat' ? 'repeat' : 'form';
    if (out[key]) continue;
    const message =
      issue.message === 'stepTitleRequired' || issue.message === 'stepTitleTooLong'
        ? issue.message
        : field === 'repeat'
          ? 'repeatRequired'
          : KNOWN_ERRORS.includes(issue.message)
            ? issue.message
            : 'invalid';
    out[key] = t(`routines.errors.${message}`);
  }
  return out;
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

function IconButton({
  label,
  onPress,
  disabled,
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.iconButton, { opacity: disabled ? 0.35 : 1 }]}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

const nextMinutes = (v: number | null) => (v === null ? 1 : Math.min(600, v < 10 ? v + 1 : v + 5));
const prevMinutes = (v: number | null) => (v === null || v <= 1 ? null : v <= 10 ? v - 1 : v - 5);

/** Create or edit a routine: name, part of day, start time, ordered steps with durations, repeat and reminder. */
export function RoutineEditorScreen({ routineId, now = new Date() }: { routineId?: string; now?: Date }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ctx = useDataContext();
  const lang = i18n.language;
  const today = localDateOf(now);
  const weekStartsOn = defaultWeekStartsOn(lang);

  const [draft, setDraft] = useState<RoutineDraft | null>(routineId ? null : emptyRoutineDraft(weekStartsOn));
  const [missing, setMissing] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitleForDelete] = useState('');

  useEffect(() => {
    if (!routineId || !ctx) return;
    let cancelled = false;
    loadRoutineForm(ctx, routineId, weekStartsOn).then(
      (f) => {
        if (cancelled) return;
        if (f) {
          setDraft(f.draft);
          setTitleForDelete(f.routine.title);
        } else setMissing(true);
      },
      () => !cancelled && setMissing(true),
    );
    return () => {
      cancelled = true;
    };
  }, [routineId, ctx, weekStartsOn]);

  const update = useCallback((patch: Partial<RoutineDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d)), []);
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/routines');
  }, [router]);

  if (routineId && !draft && !missing) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg }]}>
        <Skeleton lines={5} />
      </View>
    );
  }
  if (missing || !draft) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg }]}>
        <ErrorState onRetry={close} message={t('routines.notFound')} />
      </View>
    );
  }

  const patchStep = (index: number, p: Partial<RoutineStepDraft>) =>
    update({ steps: draft.steps.map((s, i) => (i === index ? { ...s, ...p } : s)) });

  const onSave = async () => {
    if (!ctx) return;
    const candidate: RoutineDraft = { ...draft, steps: draft.steps };
    const parsed = routineDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(errorsFrom(parsed.error, (k) => t(k as never)));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (routineId) {
        await updateRoutine(ctx, routineId, candidate);
        close();
      } else {
        const routine = await createRoutine(ctx, candidate);
        router.replace({ pathname: '/routine/[id]', params: { id: routine.id } });
      }
    } catch (error) {
      console.warn('Routine save failed', error instanceof Error ? error.name : 'unknown');
      setErrors({ form: t('routines.errors.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    setConfirmDelete(false);
    if (!ctx || !routineId) return;
    scheduleDelete(
      {
        label: title || draft.title,
        kind: 'routine',
        hide: { routineId },
        run: () => deleteRoutine(ctx, routineId),
      },
      (e) => console.warn('Routine delete failed', e instanceof Error ? e.name : 'unknown'),
    );
    router.replace('/routines');
  };

  const canSave = !saving && !!ctx;

  return (
    <KeyboardSafeView style={{ backgroundColor: colors.bg }} testID="screen-routine-editor">
      <View style={[styles.bar, { paddingTop: insets.top + space.md }]}>
        <Text variant="title1" accessibilityRole="header" style={styles.flex}>
          {routineId ? t('routines.editTitle') : t('routines.newTitle')}
        </Text>
        <Button label={t('modal.close')} variant="secondary" size="compact" icon="close" onPress={close} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <TextField
          testID="routine-title"
          label={t('routines.titleLabel')}
          placeholder={t('routines.titlePlaceholder')}
          value={draft.title}
          onChangeText={(v) => update({ title: v })}
          error={errors.title}
          large
          maxLength={80}
        />

        <Section title={t('routines.partOfDay')}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('routines.partOfDay')} style={styles.pills}>
            {PARTS_OF_DAY.map((p) => (
              <Pill
                key={p}
                role="radio"
                label={t(`routines.part_${p}`)}
                selected={draft.partOfDay === p}
                onPress={() => update({ partOfDay: p })}
                testID={`routine-part-${p}`}
              />
            ))}
          </View>
        </Section>

        <TimeSelect
          testID="routine-start"
          value={draft.startTime}
          onChange={(startTime) => update({ startTime })}
          now={now}
        />

        <Section title={t('routines.stepsTitle')} testID="routine-steps-section">
          <Text variant="caption" color={colors.textSecondary}>
            {t('routines.stepsHint')}
          </Text>
          {draft.steps.length === 0 ? (
            <Text variant="bodySm" color={colors.textSecondary} testID="routine-steps-empty">
              {t('routines.stepsEmpty')}
            </Text>
          ) : null}
          {draft.steps.map((s, index) => {
            const name = s.title.trim() || t('routines.stepFallback');
            return (
              <View
                key={s.id ?? `new-${index}`}
                style={[styles.card, { backgroundColor: colors.surface }]}
                testID={`routine-step-${index}`}
              >
                <TextField
                  testID={`routine-step-title-${index}`}
                  label={t('routines.stepLabel')}
                  placeholder={t('routines.stepPlaceholder')}
                  value={s.title}
                  onChangeText={(v) => patchStep(index, { title: v })}
                  maxLength={80}
                />
                <Stepper
                  testID={`routine-step-minutes-${index}`}
                  icons="plusMinus"
                  label={t('routines.stepMinutes')}
                  value={s.durationMin === null ? '—' : t('routines.minutes', { count: s.durationMin })}
                  previousLabel={t('routines.stepMinutesLess', { title: name })}
                  nextLabel={t('routines.stepMinutesMore', { title: name })}
                  canPrevious={s.durationMin !== null}
                  onPrevious={() => patchStep(index, { durationMin: prevMinutes(s.durationMin) })}
                  onNext={() => patchStep(index, { durationMin: nextMinutes(s.durationMin) })}
                />
                <View style={styles.actions}>
                  <IconButton
                    label={t('routines.stepMoveUp', { title: name })}
                    onPress={() => update({ steps: moveItem(draft.steps, index, -1) })}
                    disabled={index === 0}
                    testID={`routine-step-up-${index}`}
                  >
                    <View style={styles.flip}>
                      <Icon name="chevronDown" size={20} color={colors.text} />
                    </View>
                  </IconButton>
                  <IconButton
                    label={t('routines.stepMoveDown', { title: name })}
                    onPress={() => update({ steps: moveItem(draft.steps, index, 1) })}
                    disabled={index === draft.steps.length - 1}
                    testID={`routine-step-down-${index}`}
                  >
                    <Icon name="chevronDown" size={20} color={colors.text} />
                  </IconButton>
                  <View style={styles.flex} />
                  <IconButton
                    label={t('routines.stepRemove', { title: name })}
                    onPress={() => update({ steps: draft.steps.filter((_, i) => i !== index) })}
                    testID={`routine-step-remove-${index}`}
                  >
                    <Icon name="trash" size={18} color={colors.danger} />
                  </IconButton>
                </View>
              </View>
            );
          })}
          {errors.steps ? (
            <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite" testID="routine-steps-error">
              {errors.steps}
            </Text>
          ) : null}
          <Button
            testID="add-step"
            label={t('routines.addStep')}
            variant="secondary"
            icon="plus"
            onPress={() => update({ steps: [...draft.steps, { title: '', durationMin: null }] })}
            disabled={draft.steps.length >= ROUTINE_STEPS_MAX}
            fullWidth
          />
        </Section>

        <Section title={t('repeat.title')}>
          <RepeatEditor
            value={draft.repeat}
            onChange={(next) =>
              next
                ? update({ repeat: next })
                : setErrors((e) => ({ ...e, repeat: t('routines.errors.repeatRequired') }))
            }
            startDate={today}
            weekStartsOn={weekStartsOn}
            error={errors.repeat}
          />
        </Section>

        <Section title={t('reminders.title')}>
          <ItemReminderField
            value={draft.reminder ?? null}
            onChange={(reminder) => update({ reminder })}
            timed={!!draft.startTime}
          />
        </Section>

        {routineId ? (
          <Button
            testID="delete-routine"
            label={t('routines.delete')}
            variant="destructive"
            icon="trash"
            onPress={() => setConfirmDelete(true)}
            disabled={saving}
            fullWidth
          />
        ) : null}
      </KeyboardAwareScrollView>

      <View
        style={[
          styles.footer,
          { borderColor: colors.border, backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, space.sm) },
        ]}
      >
        {errors.form ? (
          <Text variant="bodySm" color={colors.danger} accessibilityLiveRegion="polite" testID="routine-form-error">
            {errors.form}
          </Text>
        ) : null}
        <Button
          testID="save-routine"
          label={saving ? t('editor.saving') : routineId ? t('routines.save') : t('routines.create')}
          onPress={() => void onSave()}
          disabled={!canSave}
          fullWidth
        />
      </View>

      <ConfirmDialog
        visible={confirmDelete}
        title={t('routines.deleteTitle', { title: title || draft.title })}
        body={t('routines.deleteBody')}
        actions={[
          { label: t('routines.delete'), variant: 'destructive', testID: 'confirm-delete-routine', onPress: onDelete },
        ]}
        onCancel={() => setConfirmDelete(false)}
        cancelLabel={t('editor.cancel')}
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
  card: { borderRadius: radii.card, padding: space.sm, gap: space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  iconButton: { width: sizes.touch, height: sizes.touch, alignItems: 'center', justifyContent: 'center' },
  flip: { transform: [{ rotate: '180deg' }] },
  footer: {
    ...columnStyle,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.xs,
  },
});
