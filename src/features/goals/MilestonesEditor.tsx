import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { MILESTONES_MAX, moveItem, type MilestoneDraft } from '../../data/milestones';
import { addDays, type LocalDate } from '../../domain/localDate';
import { shortDate } from '../../i18n/dates';
import { noonOf } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Stepper } from '../../ui/Stepper';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { radii, sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

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
  children: React.ReactNode;
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

/** Ordered milestone list for the goal form: add, rename, optional date, move up / down, delete. */
export function MilestonesEditor({
  value,
  onChange,
  today,
  lang,
  error,
}: {
  value: readonly MilestoneDraft[];
  onChange: (next: MilestoneDraft[]) => void;
  today: LocalDate;
  lang: string;
  error?: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const patch = (index: number, p: Partial<MilestoneDraft>) =>
    onChange(value.map((m, i) => (i === index ? { ...m, ...p } : m)));

  return (
    <View style={styles.stack} testID="milestones-editor">
      <Text variant="caption" color={colors.textSecondary}>
        {t('goals.milestonesHint')}
      </Text>
      {value.length === 0 ? (
        <Text variant="bodySm" color={colors.textSecondary} testID="milestones-empty">
          {t('goals.milestonesEmpty')}
        </Text>
      ) : null}
      {value.map((m, index) => {
        const name = m.title.trim() || t('goals.milestoneFallback');
        return (
          <View
            key={m.id ?? `new-${index}`}
            style={[styles.card, { backgroundColor: colors.surface }]}
            testID={`milestone-${index}`}
          >
            <TextField
              testID={`milestone-title-${index}`}
              label={t('goals.milestoneLabel')}
              placeholder={t('goals.milestonePlaceholder')}
              value={m.title}
              onChangeText={(title) => patch(index, { title })}
              maxLength={120}
            />
            <View style={styles.dateRow}>
              {m.dueDate ? (
                <View style={styles.flex}>
                  <Stepper
                    testID={`milestone-date-${index}`}
                    label={t('goals.milestoneDate')}
                    value={shortDate(noonOf(m.dueDate), lang)}
                    previousLabel={t('dates.previousDay')}
                    nextLabel={t('dates.nextDay')}
                    onPrevious={() => patch(index, { dueDate: addDays(m.dueDate ?? today, -1) })}
                    onNext={() => patch(index, { dueDate: addDays(m.dueDate ?? today, 1) })}
                  />
                </View>
              ) : (
                <View style={styles.flex}>
                  <Button
                    testID={`milestone-set-date-${index}`}
                    label={t('goals.milestoneDate')}
                    variant="secondary"
                    size="compact"
                    onPress={() => patch(index, { dueDate: today })}
                  />
                </View>
              )}
              {m.dueDate ? (
                <IconButton
                  label={t('goals.milestoneNoDate')}
                  onPress={() => patch(index, { dueDate: null })}
                  testID={`milestone-clear-date-${index}`}
                >
                  <Icon name="close" size={16} color={colors.textSecondary} />
                </IconButton>
              ) : null}
            </View>
            <View style={styles.actions}>
              <IconButton
                label={t('goals.milestoneMoveUp', { title: name })}
                onPress={() => onChange(moveItem(value, index, -1))}
                disabled={index === 0}
                testID={`milestone-up-${index}`}
              >
                <View style={styles.flip}>
                  <Icon name="chevronDown" size={20} color={colors.text} />
                </View>
              </IconButton>
              <IconButton
                label={t('goals.milestoneMoveDown', { title: name })}
                onPress={() => onChange(moveItem(value, index, 1))}
                disabled={index === value.length - 1}
                testID={`milestone-down-${index}`}
              >
                <Icon name="chevronDown" size={20} color={colors.text} />
              </IconButton>
              <View style={styles.flex} />
              <IconButton
                label={t('goals.milestoneRemove', { title: name })}
                onPress={() => onChange(value.filter((_, i) => i !== index))}
                testID={`milestone-remove-${index}`}
              >
                <Icon name="trash" size={18} color={colors.danger} />
              </IconButton>
            </View>
          </View>
        );
      })}
      {error ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite" testID="milestones-error">
          {error}
        </Text>
      ) : null}
      <Button
        testID="add-milestone"
        label={t('goals.milestoneAdd')}
        variant="secondary"
        icon="plus"
        onPress={() => onChange([...value, { title: '', dueDate: null, done: false }])}
        disabled={value.length >= MILESTONES_MAX}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xs },
  flex: { flex: 1, minWidth: 0 },
  card: { borderRadius: radii.card, padding: space.sm, gap: space.xs },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  iconButton: { width: sizes.touch, height: sizes.touch, alignItems: 'center', justifyContent: 'center' },
  flip: { transform: [{ rotate: '180deg' }] },
});
