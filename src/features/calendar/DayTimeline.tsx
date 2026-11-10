import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AgendaItem } from '../../data/queries/agenda';
import { minutesOf } from '../../domain/localDate';
import { layoutTimeline, timelineY } from '../../domain/timeline';
import { hhmmOf } from '../../domain/timeOptions';
import { formatClock, formatMinutes } from '../../lib/dates';
import { useHeaderScroll } from '../../ui/HeaderScreen';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { categoryColors } from '../../ui/theme/colors';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';
import { useTaskActions } from '../tasks/TaskActions';

export const HOUR_HEIGHT = 60;
const MIN_BLOCK = 44;
const GUTTER = 52;

function Block({
  item,
  style,
  compact,
}: {
  item: AgendaItem;
  style: { top: number; height: number; left: string; width: string };
  compact: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const actions = useTaskActions();
  const [focused, focusHandlers] = useFocusRing();
  const lang = i18n.language;
  const time = item.startTime ? formatClock(item.startTime, lang) : '';
  const end =
    item.startTime && item.durationMin
      ? formatClock(hhmmOf(Math.min(minutesOf(item.startTime) + item.durationMin, 24 * 60 - 1)), lang)
      : null;
  const accent = item.categoryColor ? categoryColors[item.categoryColor] : colors.accent;
  return (
    <Pressable
      {...focusHandlers}
      testID={`block-${item.key}`}
      onPress={item.kind === 'routine' ? () => actions.menu(item) : () => actions.open(item)}
      onLongPress={() => actions.menu(item)}
      accessibilityRole="button"
      accessibilityLabel={[
        item.title,
        end ? `${time} – ${end}` : time,
        item.durationMin ? formatMinutes(item.durationMin, lang) : null,
        item.done ? t('tasks.doneState') : null,
      ]
        .filter(Boolean)
        .join(', ')}
      style={[
        styles.block,
        {
          top: style.top,
          height: style.height,
          left: style.left as `${number}%`,
          width: style.width as `${number}%`,
          backgroundColor: colors.surface,
          borderLeftColor: accent,
          borderColor: focused ? colors.focus : colors.border,
        },
      ]}
    >
      <Text
        variant="label"
        weight={600}
        numberOfLines={compact ? 1 : 2}
        color={item.done ? colors.textSecondary : colors.text}
        style={item.done ? styles.strike : null}
      >
        {item.title}
      </Text>
      {!compact ? (
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1} style={styles.tabular}>
          {end ? `${time} – ${end}` : time}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Hour timeline for the Calendar day view: 24 hour rows, timed items at their start with a height proportional to
 * their duration (44 px minimum), overlapping items side by side, a "now" line on today. It grows inside the
 * screen's single scroll view (no nested scroller) and scrolls the screen to now (today) or the first item.
 */
export function DayTimeline({
  items,
  isToday,
  now,
  dayKey,
}: {
  items: AgendaItem[];
  isToday: boolean;
  now: Date;
  /** Changes when the day changes, to scroll again. */
  dayKey: string;
}) {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  const { scrollToIn } = useHeaderScroll();
  const lang = i18n.language;
  const gridRef = useRef<ComponentRef<typeof View>>(null);
  const [width, setWidth] = useState(0);

  const timed = useMemo(() => items.filter((i) => i.startTime), [items]);
  const blocks = useMemo(
    () =>
      layoutTimeline(
        timed.map((i) => ({ key: i.key, startMin: minutesOf(i.startTime as string), durationMin: i.durationMin })),
        { hourHeight: HOUR_HEIGHT, minHeight: MIN_BLOCK },
      ),
    [timed],
  );
  const byKey = useMemo(() => new Map(timed.map((i) => [i.key, i])), [timed]);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const firstMin = blocks.length ? Math.min(...blocks.map((b) => b.startMin)) : 8 * 60;
  const target = isToday ? Math.max(0, Math.min(nowMin, firstMin) - 30) : Math.max(0, firstMin - 30);

  // Scroll the screen to now / the first item once the grid is laid out (and again when the day changes).
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!width || scrolledFor.current === dayKey) return;
    scrolledFor.current = dayKey;
    const id = setTimeout(() => scrollToIn(gridRef.current, timelineY(target, HOUR_HEIGHT), space.xl), 0);
    return () => clearTimeout(id);
  }, [width, dayKey, target, scrollToIn]);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <View
      ref={gridRef}
      collapsable={false}
      style={[styles.grid, { height: 24 * HOUR_HEIGHT }]}
      testID="calendar-timeline"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {hours.map((h) => (
        <View key={h} style={[styles.hour, { top: h * HOUR_HEIGHT, borderTopColor: colors.border }]}>
          <Text variant="caption" color={colors.textSecondary} style={[styles.hourLabel, styles.tabular]}>
            {formatClock(hhmmOf(h * 60), lang).replace(':00', lang === 'fr' ? ':00' : '')}
          </Text>
        </View>
      ))}
      <View style={[styles.lane, { left: GUTTER }]}>
        {blocks.map((b) => {
          const item = byKey.get(b.key);
          if (!item) return null;
          const colWidth = 100 / b.columns;
          return (
            <Block
              key={b.key}
              item={item}
              compact={b.height < 52 || b.columns > 2}
              style={{
                top: b.top + 1,
                height: b.height - 2,
                left: `${b.column * colWidth}%`,
                width: `${colWidth}%`,
              }}
            />
          );
        })}
      </View>
      {isToday ? (
        <View
          pointerEvents="none"
          testID="timeline-now"
          style={[styles.now, { top: timelineY(nowMin, HOUR_HEIGHT), left: GUTTER - 6 }]}
        >
          <View style={[styles.nowKnob, { backgroundColor: colors.accent }]} />
          <View style={[styles.nowLine, { backgroundColor: colors.accent }]} />
        </View>
      ) : null}
    </View>
  );
}

/** Strip above the grid for all-day / untimed items (compact chips that open the task). */
export function AllDayStrip({ items, label }: { items: AgendaItem[]; label: string }) {
  const { colors } = useTheme();
  const actions = useTaskActions();
  if (!items.length) return null;
  return (
    <View style={[styles.strip, { borderColor: colors.border }]} testID="all-day-strip">
      <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
        {label}
      </Text>
      <View style={styles.stripItems}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            testID={`allday-${item.key}`}
            onPress={item.kind === 'routine' ? () => actions.menu(item) : () => actions.open(item)}
            onLongPress={() => actions.menu(item)}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            style={[
              styles.chip,
              {
                backgroundColor: colors.surface,
                borderLeftColor: item.categoryColor ? categoryColors[item.categoryColor] : colors.accent,
              },
            ]}
          >
            {item.done ? <Icon name="check" size={14} color={colors.textSecondary} /> : null}
            <Text
              variant="label"
              weight={600}
              numberOfLines={1}
              color={item.done ? colors.textSecondary : colors.text}
              style={[styles.shrink, item.done ? styles.strike : null]}
            >
              {item.title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { position: 'relative', marginTop: space.xs },
  hour: { position: 'absolute', left: 0, right: 0, height: HOUR_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth },
  hourLabel: { width: GUTTER - 8, marginTop: -8, paddingRight: 4, textAlign: 'right', fontSize: 11 },
  tabular: { fontVariant: ['tabular-nums'] },
  lane: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  block: {
    position: 'absolute',
    borderRadius: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    paddingHorizontal: space.xs,
    paddingVertical: 4,
    overflow: 'hidden',
    gap: 1,
  },
  strike: { textDecorationLine: 'line-through' },
  now: { position: 'absolute', right: 0, height: 10, marginTop: -5, flexDirection: 'row', alignItems: 'center' },
  nowKnob: { width: 10, height: 10, borderRadius: 5 },
  nowLine: { flex: 1, height: 2 },
  strip: { gap: space.xs, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  stripItems: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    minHeight: 40,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.input,
    borderLeftWidth: 4,
    paddingHorizontal: space.sm,
  },
  shrink: { flexShrink: 1 },
});
