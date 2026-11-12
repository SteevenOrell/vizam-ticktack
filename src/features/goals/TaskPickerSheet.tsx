import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { getLinkableTasks, type LinkableTask } from '../../data/goals';
import { useQuery } from '../../data/useQuery';
import { shortDate } from '../../i18n/dates';
import { formatClock, noonOf } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { RevealTarget } from '../../ui/keyboard';
import { Sheet } from '../../ui/Sheet';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';
import { useDataContext } from '../session/SessionProvider';

function TaskOption({
  task,
  checked,
  onToggle,
  otherGoal,
}: {
  task: LinkableTask;
  checked: boolean;
  onToggle: () => void;
  otherGoal: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const lang = i18n.language;
  const meta = [
    task.date ? shortDate(noonOf(task.date), lang) : t('editor.noDate'),
    task.start_time ? formatClock(task.start_time, lang) : null,
    task.recurring ? t('goals.repeats') : null,
    task.done ? t('goals.taskDone') : null,
    otherGoal ? t('goals.linkedTo', { title: otherGoal }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      {...focusHandlers}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${task.title}, ${meta}`}
      testID={`pick-${task.id}`}
      style={[
        styles.option,
        { backgroundColor: checked ? colors.chip : 'transparent', borderColor: focused ? colors.focus : 'transparent' },
      ]}
    >
      <View
        style={[
          styles.box,
          checked
            ? { backgroundColor: colors.accent, borderColor: colors.accent }
            : { borderColor: colors.textSecondary },
        ]}
      >
        {checked ? <Icon name="check" size={16} color={colors.onAccent} /> : null}
      </View>
      <View style={styles.optionText}>
        <Text variant="body" weight={500} numberOfLines={2}>
          {task.title}
        </Text>
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Searchable multi-select of existing tasks. Ticking a task linked to another goal moves it to this goal (the row
 * says which goal it belongs to now).
 */
interface PickerProps {
  visible: boolean;
  /** Ids ticked when the sheet opens. */
  selected: readonly string[];
  goalId?: string;
  onDone: (ids: string[]) => void;
  onClose: () => void;
}

/** Mounted only while open, so every opening starts from `selected` with an empty search. */
export function TaskPickerSheet(props: PickerProps) {
  return props.visible ? <TaskPicker {...props} /> : null;
}

function TaskPicker({ selected, goalId, onDone, onClose }: PickerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ctx = useDataContext();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selected));
  const query = useCallback(
    (db: Parameters<typeof getLinkableTasks>[0]) => getLinkableTasks(db, ctx?.ownerId ?? 'local', search),
    [ctx?.ownerId, search],
  );
  const tasks = useQuery(query);
  const list = tasks.status === 'success' ? tasks.data : [];
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Sheet
      visible
      title={t('goals.linkTasks')}
      onClose={onClose}
      closeLabel={t('modal.close')}
      testID="task-picker"
      scroll
      footer={
        <Button
          testID="task-picker-done"
          label={t('goals.linkSelected', { count: picked.size })}
          onPress={() => onDone([...picked])}
          fullWidth
        />
      }
    >
      <RevealTarget style={styles.body}>
        <TextField
          testID="task-search"
          label={t('goals.searchTasks')}
          placeholder={t('goals.searchPlaceholder')}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          returnKeyType="search"
          maxLength={100}
        />
        {list.some((task) => task.recurring) ? (
          <Text variant="caption" color={colors.textSecondary} testID="task-picker-repeat-note">
            {t('goals.repeatEndNote')}
          </Text>
        ) : null}
        {list.length === 0 && tasks.status === 'success' ? (
          <View style={styles.empty}>
            <Icon name="note" size={18} color={colors.textSecondary} />
            <Text variant="bodySm" color={colors.textSecondary} style={styles.flex}>
              {search ? t('goals.noTaskMatch') : t('goals.noTasksYet')}
            </Text>
          </View>
        ) : (
          <View accessibilityLabel={t('goals.linkTasks')} style={styles.list}>
            {list.map((task) => (
              <TaskOption
                key={task.id}
                task={task}
                checked={picked.has(task.id)}
                onToggle={() => toggle(task.id)}
                otherGoal={task.goal_id && task.goal_id !== goalId ? task.goal_title : null}
              />
            ))}
          </View>
        )}
      </RevealTarget>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { gap: space.sm, paddingBottom: space.sm },
  list: { gap: 2 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radii.input,
    borderWidth: 2,
    paddingVertical: space.xxs,
    paddingRight: space.xs,
    minHeight: 52,
  },
  optionText: { flex: 1, minWidth: 0 },
  box: {
    width: 24,
    height: 24,
    marginLeft: space.xs,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
