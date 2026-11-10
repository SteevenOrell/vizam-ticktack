import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AgendaItem } from '../../data/queries/agenda';
import { formatClock, formatMinutes } from '../../lib/dates';
import { Card } from '../../ui/Card';
import { CategoryDot, Checkbox } from '../../ui/Checkbox';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';

/** Task row: checkbox, title, time / duration / subtasks / repeat, category dot and priority flag. */
export function TaskRow({
  item,
  onToggle,
  onOpen,
  overdue,
  showDate,
}: {
  item: AgendaItem;
  onToggle: (item: AgendaItem, done: boolean) => void;
  onOpen?: (item: AgendaItem) => void;
  overdue?: boolean;
  showDate?: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const lang = i18n.language;

  const meta: string[] = [];
  if (showDate) meta.push(showDate);
  if (item.startTime) meta.push(formatClock(item.startTime, lang));
  if (item.durationMin) meta.push(formatMinutes(item.durationMin, lang));
  if (item.subtasks.total > 0) {
    meta.push(
      t(item.kind === 'routine' ? 'tasks.steps' : 'tasks.subtasks', {
        done: item.subtasks.done,
        total: item.subtasks.total,
      }),
    );
  }
  const priorityLabel =
    item.priority >= 3 ? t('tasks.priorityHigh') : item.priority === 2 ? t('tasks.priorityMedium') : null;
  const label = [
    item.title,
    ...meta,
    priorityLabel,
    item.recurring ? t('tasks.repeats') : null,
    overdue ? t('today.overdue') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card style={[styles.row, { borderColor: focused ? colors.focus : 'transparent' }]} testID={`task-${item.key}`}>
      <Checkbox
        checked={item.done}
        onChange={(done) => onToggle(item, done)}
        accessibilityLabel={t(item.done ? 'tasks.markOpen' : 'tasks.markDone', { title: item.title })}
        testID={`check-${item.key}`}
      />
      <Pressable
        {...focusHandlers}
        style={styles.body}
        onPress={onOpen ? () => onOpen(item) : undefined}
        disabled={!onOpen}
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={label}
        accessibilityHint={onOpen ? t('tasks.openHint') : undefined}
      >
        <Text
          variant="title3"
          numberOfLines={2}
          color={item.done ? colors.textSecondary : colors.text}
          style={item.done ? styles.done : null}
        >
          {item.title}
        </Text>
        {meta.length || item.recurring || overdue ? (
          <View style={styles.metaRow}>
            {overdue ? (
              <Text variant="caption" color={colors.danger}>
                {t('today.overdue')}
              </Text>
            ) : null}
            {meta.length ? (
              <Text variant="caption" color={colors.textSecondary} style={styles.metaText}>
                {meta.join(' · ')}
              </Text>
            ) : null}
            {item.recurring ? <Icon name="repeat" size={14} color={colors.textSecondary} /> : null}
          </View>
        ) : null}
      </Pressable>
      <View style={styles.side}>
        {priorityLabel ? (
          <Icon name="flag" size={18} color={item.priority >= 3 ? colors.danger : colors.textSecondary} />
        ) : null}
        <CategoryDot color={item.categoryColor} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs,
    paddingLeft: space.xs,
    borderWidth: 2,
  },
  body: { flex: 1, minHeight: 44, justifyContent: 'center', gap: 2 },
  done: { textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  metaText: { fontVariant: ['tabular-nums'], flexShrink: 1 },
  side: { alignItems: 'center', gap: space.xs, minWidth: 18 },
});
