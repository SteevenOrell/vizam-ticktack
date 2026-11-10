import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { getGoalOptions, goalTitleSchema } from '../../data/goals';
import type { CategoryOption } from '../../data/queries/agenda';
import { useQuery } from '../../data/useQuery';
import { categoryKey, CATEGORY_NAME_MAX, matchCategories, normalizeCategoryName } from '../../domain/categoryName';
import { durationOptions, initialTimeIndex, timeOptions } from '../../domain/timeOptions';
import { formatClock, formatMinutes } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { CategoryDot } from '../../ui/Checkbox';
import { Icon } from '../../ui/Icon';
import { RevealTarget, RevealWhen } from '../../ui/keyboard';
import { Pill } from '../../ui/Pill';
import { SelectField, type SelectOption } from '../../ui/SelectField';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext } from '../session/SessionProvider';

const hhmmNow = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Start time dropdown: "All day", then every 15 minutes; opens on the selected time or around now. */
export function TimeSelect({
  value,
  onChange,
  now,
  testID = 'field-time',
  compact,
  error,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  now: Date;
  testID?: string;
  compact?: boolean;
  error?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const options = useMemo<SelectOption<string | null>[]>(
    () => [
      { value: null, label: t('editor.allDay') },
      ...timeOptions(value).map((v) => ({ value: v, label: formatClock(v, lang) })),
    ],
    [lang, t, value],
  );
  const times = useMemo(() => options.slice(1).map((o) => o.value as string), [options]);
  return (
    <SelectField
      testID={testID}
      label={t('editor.startTime')}
      value={value}
      options={options}
      onChange={onChange}
      closeLabel={t('modal.close')}
      initialIndex={initialTimeIndex(times, value, hhmmNow(now)) + 1}
      compact={compact}
      error={error}
    />
  );
}

/** Duration dropdown: "None", 5 min … 12 h (see DURATION_OPTIONS). */
export function DurationSelect({
  value,
  onChange,
  testID = 'field-duration',
  compact,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  testID?: string;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const options = useMemo<SelectOption<number | null>[]>(
    () => [
      { value: null, label: t('editor.none') },
      ...durationOptions(value).map((m) => ({ value: m, label: formatMinutes(m, lang) })),
    ],
    [lang, t, value],
  );
  return (
    <SelectField
      testID={testID}
      label={t('editor.duration')}
      value={value}
      options={options}
      onChange={onChange}
      closeLabel={t('modal.close')}
      initialIndex={options.findIndex((o) => o.value === 30)}
      compact={compact}
    />
  );
}

/**
 * Free-text category with suggestions from the existing categories. Typing a new name creates the category on save
 * (case-insensitive: "work" picks "Work").
 */
export function CategoryField({
  value,
  onChange,
  categories,
  testID = 'field-category',
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  categories: readonly CategoryOption[];
  testID?: string;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const clean = normalizeCategoryName(value);
  const exact = clean ? categories.find((c) => categoryKey(c.name) === categoryKey(clean)) : undefined;
  const suggestions = matchCategories(categories, value).filter((c) => c.id !== exact?.id || !focused);
  const tooLong = (clean?.length ?? 0) > CATEGORY_NAME_MAX;

  return (
    // The field and its suggestions stay above the keyboard together.
    <RevealTarget style={styles.gap}>
      <RevealWhen token={suggestions.length} active={focused} />
      <TextField
        testID={testID}
        label={t('editor.category')}
        placeholder={t('editor.categoryPlaceholder')}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={60}
        autoCapitalize="sentences"
        autoCorrect={false}
        error={error ?? (tooLong ? t('editor.errors.categoryTooLong') : undefined)}
        returnKeyType="done"
      />
      {clean && !exact && !tooLong ? (
        <View style={styles.hintRow} testID="category-new-hint">
          <Icon name="plus" size={14} color={colors.accentText} />
          <Text variant="caption" color={colors.textSecondary} accessibilityLiveRegion="polite">
            {t('editor.categoryNew', { name: clean })}
          </Text>
        </View>
      ) : null}
      {suggestions.length ? (
        <View style={styles.pills} accessibilityLabel={t('editor.categorySuggestions')} testID="category-suggestions">
          {suggestions.map((c) => (
            <Pill
              key={c.id}
              label={c.name}
              dot={c.color}
              role="radio"
              selected={exact?.id === c.id}
              onPress={() => onChange(exact?.id === c.id ? '' : c.name)}
            />
          ))}
        </View>
      ) : null}
    </RevealTarget>
  );
}

const NEW_GOAL = '__new_goal__';

/**
 * Goal selector with an inline "New goal" path (name only). The new goal is created when the task is saved, in the
 * same transaction, so a goal never exists without a task.
 */
export function GoalField({
  value,
  onChange,
  newTitle,
  onNewTitle,
  testID = 'field-goal',
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Pending new goal name (created on save). */
  newTitle?: string | null;
  onNewTitle?: (title: string | null) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ctx = useDataContext();
  const query = useCallback(
    (db: Parameters<typeof getGoalOptions>[0]) => getGoalOptions(db, ctx?.ownerId ?? 'local'),
    [ctx?.ownerId],
  );
  const goals = useQuery(query);
  const list = goals.status === 'success' ? goals.data : [];
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options: SelectOption<string | null>[] = [
    { value: null, label: t('editor.noGoal') },
    ...(newTitle ? [{ value: NEW_GOAL, label: t('editor.newGoalPending', { title: newTitle }) }] : []),
    ...list.map((g) => ({ value: g.id, label: g.title })),
  ];

  const create = (close: () => void) => {
    const parsed = goalTitleSchema.safeParse(name);
    if (!parsed.success) {
      setError(t('editor.errors.goalInvalid'));
      return;
    }
    setName('');
    setError(null);
    onChange(null);
    onNewTitle?.(parsed.data);
    close();
  };

  return (
    <SelectField
      testID={testID}
      label={t('editor.goal')}
      value={newTitle ? NEW_GOAL : value}
      options={options}
      onChange={(v) => {
        if (v === NEW_GOAL) return;
        onNewTitle?.(null);
        onChange(v);
      }}
      closeLabel={t('modal.close')}
      extra={(close) => (
        <View style={[styles.create, { borderColor: colors.border }]}>
          {list.length === 0 ? (
            <Text variant="bodySm" color={colors.textSecondary}>
              {t('editor.goalEmpty')}
            </Text>
          ) : null}
          <View style={styles.createRow}>
            <View style={styles.flex}>
              <TextField
                testID="field-new-goal"
                label={t('editor.newGoal')}
                placeholder={t('editor.newGoalPlaceholder')}
                value={name}
                onChangeText={setName}
                maxLength={120}
                error={error}
                onSubmitEditing={() => create(close)}
              />
            </View>
            <Button
              testID="create-goal"
              label={t('editor.add')}
              variant="secondary"
              size="compact"
              icon="plus"
              disabled={!name.trim()}
              onPress={() => create(close)}
            />
          </View>
        </View>
      )}
    />
  );
}

/** Compact read-only chip used in previews: goal or category name with an icon / dot. */
export function MetaChip({
  label,
  dot,
  icon,
}: {
  label: string;
  dot?: CategoryOption['color'] | null;
  icon?: 'goals';
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.chip}>
      {dot ? <CategoryDot color={dot} size={8} /> : null}
      {icon ? <Icon name={icon} size={12} color={colors.textSecondary} /> : null}
      <Text variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.shrink}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.xs },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  create: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.sm, paddingTop: space.sm, gap: space.xs },
  createRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radii.pill, flexShrink: 1 },
});
