import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AgendaItem } from '../../data/queries/agenda';
import { clockParts, formatClock, formatMinutes } from '../../lib/dates';
import { Card } from '../../ui/Card';
import { CategoryDot, Checkbox } from '../../ui/Checkbox';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { fontFamilies } from '../../ui/theme/typography';
import { useFocusRing } from '../../ui/useFocusRing';
import { SwipeRow } from './SwipeRow';
import { useTaskActions } from './TaskActions';

const PREVIEW_SUBTASKS = 2;

/** Left time column: start time (Space Grotesk) with the duration under it; "Anytime" for untimed items. */
function TimeColumn({ item }: { item: AgendaItem }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const lang = i18n.language;
  const muted = item.done ? colors.textSecondary : colors.text;
  if (!item.startTime) {
    return (
      <View style={styles.time} testID={`time-${item.key}`}>
        <Text variant="caption" weight={500} color={colors.textSecondary} align="center">
          {t('tasks.anytime')}
        </Text>
        {item.durationMin ? (
          <Text variant="caption" color={colors.textSecondary} align="center" style={styles.tabular}>
            {formatMinutes(item.durationMin, lang)}
          </Text>
        ) : null}
      </View>
    );
  }
  const { main, suffix } = clockParts(item.startTime, lang);
  return (
    <View style={styles.time} testID={`time-${item.key}`}>
      <Text variant="title3" color={muted} align="center" style={styles.clock} numberOfLines={1}>
        {main}
        {suffix ? (
          <Text variant="caption" color={colors.textSecondary} style={styles.suffix}>
            {` ${suffix}`}
          </Text>
        ) : null}
      </Text>
      {item.durationMin ? (
        <Text variant="caption" color={colors.textSecondary} align="center" style={styles.tabular}>
          {formatMinutes(item.durationMin, lang)}
        </Text>
      ) : null}
    </View>
  );
}

function SubtaskLine({ title, done }: { title: string; done: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.subLine}>
      <View
        style={[
          styles.miniCheck,
          done ? { backgroundColor: colors.accent, borderColor: colors.accent } : { borderColor: colors.textSecondary },
        ]}
      >
        {done ? <Icon name="check" size={10} color={colors.onAccent} /> : null}
      </View>
      <Text
        variant="caption"
        color={colors.textSecondary}
        numberOfLines={1}
        style={[styles.shrink, done ? styles.done : null]}
      >
        {title}
      </Text>
    </View>
  );
}

/**
 * Task row: time column, checkbox, title, meta (category, goal, priority, repeat), a compact preview of subtasks and
 * notes that expands in place, and a "⋯" menu. Swipe right completes, swipe left reveals Edit / Delete.
 */
export function TaskRow({ item, overdue, showDate }: { item: AgendaItem; overdue?: boolean; showDate?: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const actions = useTaskActions();
  const [focused, focusHandlers] = useFocusRing();
  const [expanded, setExpanded] = useState(false);
  const lang = i18n.language;
  const isRoutine = item.kind === 'routine';
  const subs = item.subtaskItems;
  const hasPreview = subs.length > 0 || !!item.notes;

  const priorityLabel =
    item.priority >= 3 ? t('tasks.priorityHigh') : item.priority === 2 ? t('tasks.priorityMedium') : null;
  const countLabel =
    item.subtasks.total > 0
      ? t(isRoutine ? 'tasks.steps' : 'tasks.subtasks', { done: item.subtasks.done, total: item.subtasks.total })
      : null;
  const label = [
    item.title,
    item.startTime ? formatClock(item.startTime, lang) : t('tasks.anytime'),
    item.durationMin ? formatMinutes(item.durationMin, lang) : null,
    showDate,
    item.categoryName,
    item.goalTitle ? t('tasks.goalLabel', { title: item.goalTitle }) : null,
    countLabel,
    priorityLabel,
    item.recurring ? t('tasks.repeats') : null,
    overdue ? t('today.overdue') : null,
  ]
    .filter(Boolean)
    .join(', ');

  const metaText = [showDate, item.categoryName, countLabel].filter(Boolean).join(' · ');
  const hasMeta = !!(metaText || item.goalTitle || priorityLabel || item.recurring || overdue);

  return (
    <SwipeRow
      done={item.done}
      onComplete={() => actions.toggle(item, !item.done)}
      onQuickEdit={isRoutine ? undefined : () => actions.quickEdit(item)}
      onDelete={isRoutine ? undefined : () => actions.remove(item)}
    >
      <Card style={[styles.row, { borderColor: focused ? colors.focus : 'transparent' }]} testID={`task-${item.key}`}>
        <TimeColumn item={item} />
        <Checkbox
          checked={item.done}
          onChange={(done) => actions.toggle(item, done)}
          accessibilityLabel={t(item.done ? 'tasks.markOpen' : 'tasks.markDone', { title: item.title })}
          testID={`check-${item.key}`}
        />
        <View style={styles.body}>
          <Pressable
            {...focusHandlers}
            style={styles.main}
            onPress={isRoutine ? undefined : () => actions.open(item)}
            onLongPress={() => actions.menu(item)}
            delayLongPress={350}
            accessibilityRole={isRoutine ? undefined : 'button'}
            accessibilityLabel={label}
            accessibilityHint={isRoutine ? undefined : t('tasks.openHint')}
            accessibilityActions={
              isRoutine
                ? undefined
                : [
                    { name: 'quickEdit', label: t('tasks.quickEdit') },
                    { name: 'delete', label: t('tasks.delete') },
                  ]
            }
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'quickEdit') actions.quickEdit(item);
              if (e.nativeEvent.actionName === 'delete') actions.remove(item);
            }}
          >
            <Text
              variant="title3"
              numberOfLines={2}
              color={item.done ? colors.textSecondary : colors.text}
              style={item.done ? styles.done : null}
            >
              {item.title}
            </Text>
            {hasMeta ? (
              <View style={styles.metaRow}>
                {overdue ? (
                  <Text variant="caption" color={colors.danger}>
                    {t('today.overdue')}
                  </Text>
                ) : null}
                {item.categoryColor ? <CategoryDot color={item.categoryColor} size={8} /> : null}
                {metaText ? (
                  <Text variant="caption" color={colors.textSecondary} style={styles.metaText} numberOfLines={1}>
                    {metaText}
                  </Text>
                ) : null}
                {item.goalTitle ? (
                  <View style={styles.goal}>
                    <Icon name="goals" size={12} color={colors.textSecondary} />
                    <Text variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.shrink}>
                      {item.goalTitle}
                    </Text>
                  </View>
                ) : null}
                {priorityLabel ? (
                  <Icon name="flag" size={14} color={item.priority >= 3 ? colors.danger : colors.textSecondary} />
                ) : null}
                {item.recurring ? <Icon name="repeat" size={14} color={colors.textSecondary} /> : null}
              </View>
            ) : null}
          </Pressable>

          {hasPreview && !expanded ? (
            <Pressable
              testID={`preview-${item.key}`}
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityState={{ expanded: false }}
              accessibilityLabel={t('tasks.showDetails', { title: item.title })}
              style={styles.preview}
            >
              {subs.slice(0, PREVIEW_SUBTASKS).map((s) => (
                <SubtaskLine key={s.id} title={s.title} done={s.done} />
              ))}
              {subs.length > PREVIEW_SUBTASKS ? (
                <Text variant="caption" weight={500} color={colors.accentText}>
                  {t('tasks.moreSubtasks', { count: subs.length - PREVIEW_SUBTASKS })}
                </Text>
              ) : null}
              {item.notes ? (
                <View style={styles.subLine}>
                  <Icon name="note" size={14} color={colors.textSecondary} />
                  <Text variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.shrink}>
                    {item.notes.replace(/\s+/g, ' ').trim()}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}

          {hasPreview && expanded ? (
            <View style={styles.expanded} testID={`expanded-${item.key}`}>
              {subs.map((s) => (
                <View key={s.id} style={styles.subRow}>
                  <Checkbox
                    checked={s.done}
                    onChange={(done) => actions.tickSubtask(item, s.id, done)}
                    accessibilityLabel={t(s.done ? 'tasks.markOpen' : 'tasks.markDone', { title: s.title })}
                    testID={`sub-${item.key}-${s.id}`}
                  />
                  <Text
                    variant="bodySm"
                    color={s.done ? colors.textSecondary : colors.text}
                    style={[styles.shrink, s.done ? styles.done : null]}
                  >
                    {s.title}
                  </Text>
                </View>
              ))}
              {item.notes ? (
                <Text variant="bodySm" color={colors.textSecondary} numberOfLines={12} style={styles.notes}>
                  {item.notes}
                </Text>
              ) : null}
              <Pressable
                onPress={() => setExpanded(false)}
                accessibilityRole="button"
                accessibilityState={{ expanded: true }}
                accessibilityLabel={t('tasks.hideDetails', { title: item.title })}
                style={styles.collapse}
                testID={`collapse-${item.key}`}
              >
                <Text variant="caption" weight={500} color={colors.accentText}>
                  {t('tasks.hide')}
                </Text>
                <Icon name="chevronDown" size={14} color={colors.accentText} />
              </Pressable>
            </View>
          ) : null}
        </View>
        <Pressable
          testID={`more-${item.key}`}
          onPress={() => actions.menu(item)}
          accessibilityRole="button"
          accessibilityLabel={t('tasks.moreActions', { title: item.title })}
          style={styles.more}
        >
          <Icon name="more" size={20} color={colors.textSecondary} />
        </Pressable>
      </Card>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xxs,
    paddingVertical: space.xs,
    paddingLeft: space.xs,
    paddingRight: 0,
    borderWidth: 2,
  },
  time: { width: 64, minHeight: sizes.touch, justifyContent: 'center', alignItems: 'center' },
  clock: { fontFamily: fontFamilies.displaySemiBold, fontSize: 17, lineHeight: 22, letterSpacing: 0 },
  suffix: { fontSize: 11, letterSpacing: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  body: { flex: 1, minWidth: 0 },
  main: { minHeight: sizes.touch, justifyContent: 'center', gap: 2, paddingTop: 2 },
  done: { textDecorationLine: 'line-through' },
  // One line: the text parts truncate, the dot and icons keep their size.
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'nowrap', minWidth: 0 },
  metaText: { fontVariant: ['tabular-nums'], flexShrink: 1, minWidth: 0 },
  goal: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 2, minWidth: 0 },
  shrink: { flexShrink: 1 },
  preview: { gap: 3, paddingTop: space.xxs, paddingBottom: space.xxs, minHeight: 32, justifyContent: 'center' },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniCheck: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expanded: { paddingTop: space.xxs, gap: 0 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, marginLeft: -space.xs },
  notes: { paddingVertical: space.xxs },
  collapse: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' },
  more: { width: 40, minHeight: sizes.touch, alignItems: 'center', justifyContent: 'center' },
});
