import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PanResponder, Platform, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import type { AgendaItem } from '../../data/queries/agenda';
import { minutesOf, type LocalDate } from '../../domain/localDate';
import { dragStartMinutes, draggedTime, nudgedTime, NUDGE_MIN } from '../../domain/reschedule';
import { layoutTimeline, timelineY } from '../../domain/timeline';
import { hhmmOf } from '../../domain/timeOptions';
import { dayLabel } from '../../i18n/dates';
import { formatClock, formatMinutes, noonOf } from '../../lib/dates';
import { useHeaderScroll } from '../../ui/HeaderScreen';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { categoryColors } from '../../ui/theme/colors';
import { radii, sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';
import { useTaskActions } from '../tasks/TaskActions';

export const HOUR_HEIGHT = 60;
const MIN_BLOCK = 44;
const GUTTER = 52;

interface DragProps {
  onMove: (dy: number) => void;
  onEnd: (dy: number | null) => void;
}

/**
 * Drag state outside React render (same pattern as SwipePager). A long press arms the drag; from then on the block
 * captures the moves, so neither the screen scroll nor the day pager takes them. Before the long press nothing is
 * claimed: a normal drag over a block still scrolls the screen.
 */
function createDrag() {
  const state = {
    active: false,
    captured: false,
    /** Screen Y of the long press. The pan's own distance starts at its first move, which would lose a few px. */
    originY: null as number | null,
    props: { onMove: () => undefined, onEnd: () => undefined } as DragProps,
    setProps(next: DragProps) {
      state.props = next;
    },
    start(pageY?: number) {
      state.active = true;
      state.captured = false;
      state.originY = typeof pageY === 'number' && Number.isFinite(pageY) ? pageY : null;
    },
    stop() {
      state.active = false;
      state.captured = false;
      state.originY = null;
    },
    distance(g: { dy: number; moveY: number }) {
      return state.originY !== null && g.moveY ? g.moveY - state.originY : g.dy;
    },
    responder: null as unknown as ReturnType<typeof PanResponder.create>,
  };
  state.responder = PanResponder.create({
    onMoveShouldSetPanResponderCapture: () => {
      if (state.active) state.captured = true;
      return state.active;
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => state.props.onMove(state.distance(g)),
    onPanResponderRelease: (_, g) => state.props.onEnd(state.distance(g)),
    onPanResponderTerminate: () => state.props.onEnd(null),
  });
  return state;
}

function Block({
  item,
  style,
  compact,
  narrow,
}: {
  item: AgendaItem;
  style: { top: number; height: number; left: string; width: string };
  compact: boolean;
  /** Week column: the time line is left out unless the block is tall. */
  narrow: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const actions = useTaskActions();
  const { setScrollEnabled } = useHeaderScroll();
  const [focused, focusHandlers] = useFocusRing();
  const [drag] = useState(createDrag);
  const [dy, setDy] = useState<number | null>(null);
  // Where a dropped block waits until the saved time comes back from the database (no jump back in between).
  const [held, setHeld] = useState<{ from: string | null; min: number } | null>(null);
  const wrapRef = useRef<ComponentRef<typeof View>>(null);
  const lang = i18n.language;
  const draggable = item.kind !== 'routine';
  const startMin = minutesOf(item.startTime as string);
  const dragging = dy !== null;
  const heldMin = held && held.from === item.startTime ? held.min : null;
  const shownMin = dragging ? dragStartMinutes(startMin, dy, HOUR_HEIGHT) : (heldMin ?? startMin);
  const shownStart = hhmmOf(shownMin);

  const time = formatClock(shownStart, lang);
  const end = item.durationMin ? formatClock(hhmmOf(Math.min(shownMin + item.durationMin, 24 * 60 - 1)), lang) : null;
  const accent = item.categoryColor ? categoryColors[item.categoryColor] : colors.accent;

  const finish = useCallback(
    (endDy: number | null) => {
      if (!drag.active) return;
      drag.stop();
      setDy(null);
      setScrollEnabled(true);
      if (endDy === null) return;
      const moved = draggedTime(startMin, endDy, HOUR_HEIGHT);
      // Pressed long without moving: the row menu, as before drag existed.
      if (!moved) return actions.menu(item);
      if (!(item.recurring && item.occurrenceId)) {
        setHeld({ from: item.startTime, min: minutesOf(moved) });
        setTimeout(() => setHeld(null), 2000);
      }
      actions.reschedule(item, moved);
    },
    [actions, drag, item, setScrollEnabled, startMin],
  );
  const begin = (e?: GestureResponderEvent) => {
    drag.start(e?.nativeEvent?.pageY);
    setDy(0);
    setScrollEnabled(false);
  };
  const nudge = (delta: number) => {
    const next = nudgedTime(hhmmOf(startMin), delta);
    if (next) actions.reschedule(item, next);
  };

  useEffect(() => {
    drag.setProps({ onMove: setDy, onEnd: finish });
  }, [drag, finish]);
  // A block that disappears mid-drag (data refresh) must not leave the screen scroll frozen.
  useEffect(
    () => () => {
      if (drag.active) setScrollEnabled(true);
    },
    [drag, setScrollEnabled],
  );
  // Web touch: the browser would scroll the page under an armed drag and open its long-press menu.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = wrapRef.current as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    const stop = (e: Event) => {
      if (drag.active) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('contextmenu', stop);
    return () => {
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('contextmenu', stop);
    };
  }, [drag]);

  const top = dragging || heldMin !== null ? timelineY(shownMin, HOUR_HEIGHT) + 1 : style.top;
  return (
    <View
      ref={wrapRef}
      collapsable={false}
      {...(draggable ? drag.responder.panHandlers : null)}
      style={[
        styles.blockWrap,
        {
          top: Math.min(top, 24 * HOUR_HEIGHT - style.height),
          height: style.height,
          left: style.left as `${number}%`,
          width: style.width as `${number}%`,
        },
        dragging ? styles.lifted : null,
      ]}
    >
      <Pressable
        {...focusHandlers}
        testID={`block-${item.key}`}
        onPress={item.kind === 'routine' ? () => actions.menu(item) : () => actions.open(item)}
        onLongPress={draggable ? begin : () => actions.menu(item)}
        onPressOut={() => {
          // Released after a long press without a drag in between.
          if (drag.active && !drag.captured) finish(0);
        }}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={[
          item.title,
          end ? `${time} – ${end}` : time,
          item.durationMin ? formatMinutes(item.durationMin, lang) : null,
          item.done ? t('tasks.doneState') : null,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={draggable ? t('calendar.dragHint') : undefined}
        accessibilityActions={
          draggable
            ? [
                { name: 'earlier', label: t('calendar.moveEarlier', { count: NUDGE_MIN }) },
                { name: 'later', label: t('calendar.moveLater', { count: NUDGE_MIN }) },
                { name: 'quickEdit', label: t('tasks.quickEdit') },
              ]
            : undefined
        }
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'earlier') nudge(-NUDGE_MIN);
          if (e.nativeEvent.actionName === 'later') nudge(NUDGE_MIN);
          if (e.nativeEvent.actionName === 'quickEdit') actions.quickEdit(item);
        }}
        style={[
          styles.block,
          {
            backgroundColor: dragging ? colors.chip : colors.surface,
            borderLeftColor: accent,
            borderColor: dragging ? colors.accent : focused ? colors.focus : colors.border,
          },
        ]}
      >
        {dragging && compact ? null : (
          <Text
            variant="label"
            weight={600}
            numberOfLines={compact ? 1 : 2}
            color={item.done ? colors.textSecondary : colors.text}
            style={item.done ? styles.strike : null}
          >
            {item.title}
          </Text>
        )}
        {dragging || !compact || (narrow && style.height >= 52) ? (
          <Text
            variant="caption"
            weight={dragging ? 500 : undefined}
            color={dragging ? colors.accentText : colors.textSecondary}
            numberOfLines={1}
            style={styles.tabular}
            testID={dragging ? 'drag-time' : undefined}
          >
            {end && !narrow ? `${time} – ${end}` : time}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

export interface TimelineDay {
  date: LocalDate;
  items: AgendaItem[];
}

/** One day column: its timed items at their start, overlapping ones side by side, and the "now" line on today. */
function Lane({
  day,
  isToday,
  nowMin,
  narrow,
  divider,
}: {
  day: TimelineDay;
  isToday: boolean;
  nowMin: number;
  narrow: boolean;
  divider: boolean;
}) {
  const { colors } = useTheme();
  const timed = useMemo(() => day.items.filter((i) => i.startTime), [day.items]);
  const blocks = useMemo(
    () =>
      layoutTimeline(
        timed.map((i) => ({ key: i.key, startMin: minutesOf(i.startTime as string), durationMin: i.durationMin })),
        { hourHeight: HOUR_HEIGHT, minHeight: MIN_BLOCK },
      ),
    [timed],
  );
  const byKey = useMemo(() => new Map(timed.map((i) => [i.key, i])), [timed]);
  return (
    <View
      style={[
        styles.lane,
        divider ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border } : null,
      ]}
      testID={`timeline-lane-${day.date}`}
    >
      {blocks.map((b) => {
        const item = byKey.get(b.key);
        if (!item) return null;
        const colWidth = 100 / b.columns;
        return (
          <Block
            key={b.key}
            item={item}
            narrow={narrow}
            compact={narrow || b.height < 52 || b.columns > 2}
            style={{
              top: b.top + 1,
              height: b.height - 2,
              left: `${b.column * colWidth}%`,
              width: `${colWidth}%`,
            }}
          />
        );
      })}
      {isToday ? (
        <View pointerEvents="none" testID="timeline-now" style={[styles.now, { top: timelineY(nowMin, HOUR_HEIGHT) }]}>
          <View style={[styles.nowKnob, { backgroundColor: colors.accent }]} />
          <View style={[styles.nowLine, { backgroundColor: colors.accent }]} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Hour grid shared by the day timeline (one column) and the week grid (seven): 24 hour rows, one lane per day. It
 * grows inside the screen's single scroll view (no nested scroller) and scrolls the screen to now (when today is
 * shown) or to the first item.
 */
function HourGrid({
  days,
  today,
  now,
  scrollKey,
  testID,
}: {
  days: TimelineDay[];
  today: LocalDate;
  now: Date;
  /** Changes when the day or week changes, to scroll again. */
  scrollKey: string;
  testID: string;
}) {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  const { scrollToIn } = useHeaderScroll();
  const lang = i18n.language;
  const gridRef = useRef<ComponentRef<typeof View>>(null);
  const [width, setWidth] = useState(0);
  const narrow = days.length > 1;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showsToday = days.some((d) => d.date === today);
  const starts = days.flatMap((d) => d.items.flatMap((i) => (i.startTime ? [minutesOf(i.startTime)] : [])));
  const firstMin = starts.length ? Math.min(...starts) : 8 * 60;
  // One hour of context above now / the first item.
  const target = Math.max(0, (showsToday ? Math.min(nowMin, firstMin) : firstMin) - 60);

  // Scroll the screen to now / the first item once the grid is laid out (and again when the range changes).
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!width || scrolledFor.current === scrollKey) return;
    scrolledFor.current = scrollKey;
    const id = setTimeout(() => scrollToIn(gridRef.current, timelineY(target, HOUR_HEIGHT), space.xl), 0);
    return () => clearTimeout(id);
  }, [width, scrollKey, target, scrollToIn]);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <View
      ref={gridRef}
      collapsable={false}
      style={[styles.grid, { height: 24 * HOUR_HEIGHT }]}
      testID={testID}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {hours.map((h) => (
        <View key={h} style={[styles.hour, { top: h * HOUR_HEIGHT, borderTopColor: colors.border }]}>
          <Text variant="caption" color={colors.textSecondary} style={[styles.hourLabel, styles.tabular]}>
            {formatClock(hhmmOf(h * 60), lang).replace(':00', lang === 'fr' ? ':00' : '')}
          </Text>
        </View>
      ))}
      <View style={styles.lanes}>
        {days.map((day, index) => (
          <Lane
            key={day.date}
            day={day}
            isToday={day.date === today}
            nowMin={nowMin}
            narrow={narrow}
            divider={narrow && index > 0}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Hour timeline for the Calendar day view: timed items at their start with a height proportional to their duration
 * (44 px minimum), overlapping items side by side, a "now" line on today. Long-press a block and drag it to move it
 * to another start time (5-minute steps).
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
  /** The day shown (`YYYY-MM-DD`); the screen scrolls again when it changes. */
  dayKey: string;
}) {
  const days = useMemo(() => [{ date: dayKey, items }], [dayKey, items]);
  return <HourGrid days={days} today={isToday ? dayKey : ''} now={now} scrollKey={dayKey} testID="calendar-timeline" />;
}

function ItemChip({ item, small }: { item: AgendaItem; small?: boolean }) {
  const { colors } = useTheme();
  const actions = useTaskActions();
  return (
    <Pressable
      testID={`allday-${item.key}`}
      onPress={item.kind === 'routine' ? () => actions.menu(item) : () => actions.open(item)}
      onLongPress={() => actions.menu(item)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      style={[
        styles.chip,
        small ? styles.chipSmall : null,
        {
          backgroundColor: colors.surface,
          borderLeftColor: item.categoryColor ? categoryColors[item.categoryColor] : colors.accent,
        },
      ]}
    >
      {item.done ? <Icon name="check" size={14} color={colors.textSecondary} /> : null}
      <Text
        variant={small ? 'caption' : 'label'}
        weight={600}
        numberOfLines={1}
        color={item.done ? colors.textSecondary : colors.text}
        style={[styles.shrink, item.done ? styles.strike : null]}
      >
        {item.title}
      </Text>
    </Pressable>
  );
}

/** Strip above the grid for all-day / untimed items (compact chips that open the task). */
export function AllDayStrip({ items, label }: { items: AgendaItem[]; label: string }) {
  const { colors } = useTheme();
  if (!items.length) return null;
  return (
    <View style={[styles.strip, { borderColor: colors.border }]} testID="all-day-strip">
      <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
        {label}
      </Text>
      <View style={styles.stripItems}>
        {items.map((item) => (
          <ItemChip key={item.key} item={item} />
        ))}
      </View>
    </View>
  );
}

/**
 * Week view on tablet and desktop (768 pt and up): seven day columns on one hour grid, with a header of weekday and
 * date per column (tap to select the day) and the untimed items of each day above the grid. Blocks move the same
 * way as on the day timeline (long press and drag, or the "move earlier / later" actions); a drag changes the time,
 * not the day.
 */
export function WeekGrid({
  days,
  today,
  selected,
  now,
  onSelect,
  allDayLabel,
}: {
  days: TimelineDay[];
  today: LocalDate;
  selected: LocalDate;
  now: Date;
  onSelect: (date: LocalDate) => void;
  allDayLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const lang = i18n.language;
  const untimed = days.map((d) => d.items.filter((i) => !i.startTime));
  const hasUntimed = untimed.some((list) => list.length > 0);
  return (
    <View testID="week-grid">
      <View style={styles.weekHead} accessibilityRole="radiogroup" accessibilityLabel={t('calendar.weekStrip')}>
        {days.map((d) => {
          const isSelected = d.date === selected;
          const isToday = d.date === today;
          return (
            <Pressable
              key={d.date}
              testID={`week-col-${d.date}`}
              onPress={() => onSelect(d.date)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, checked: isSelected }}
              accessibilityLabel={[
                dayLabel(noonOf(d.date), lang),
                isToday ? t('calendar.today') : null,
                t('calendar.itemCount', { count: d.items.length }),
              ]
                .filter(Boolean)
                .join(', ')}
              style={[styles.weekDay, { backgroundColor: isSelected ? colors.chip : 'transparent' }]}
            >
              <Text
                variant="label"
                weight={isSelected || isToday ? 600 : 500}
                color={isToday ? colors.accentText : isSelected ? colors.text : colors.textSecondary}
                align="center"
                numberOfLines={1}
              >
                {dayLabel(noonOf(d.date), lang)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hasUntimed ? (
        <View style={[styles.weekAllDay, { borderColor: colors.border }]} testID="week-all-day">
          <Text variant="caption" color={colors.textSecondary} style={styles.weekAllDayLabel} numberOfLines={2}>
            {allDayLabel}
          </Text>
          {untimed.map((list, i) => (
            <View key={days[i]?.date ?? i} style={styles.weekAllDayCol}>
              {list.map((item) => (
                <ItemChip key={item.key} item={item} small />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <HourGrid days={days} today={today} now={now} scrollKey={days[0]?.date ?? ''} testID="week-timeline" />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { position: 'relative', marginTop: space.xs },
  hour: { position: 'absolute', left: 0, right: 0, height: HOUR_HEIGHT, borderTopWidth: StyleSheet.hairlineWidth },
  hourLabel: { width: GUTTER - 8, marginTop: -8, paddingRight: 4, textAlign: 'right', fontSize: 11 },
  tabular: { fontVariant: ['tabular-nums'] },
  lanes: { position: 'absolute', top: 0, bottom: 0, right: 0, left: GUTTER, flexDirection: 'row' },
  lane: { flex: 1, position: 'relative' },
  blockWrap: { position: 'absolute', userSelect: 'none' },
  // Above its neighbours while it is dragged.
  lifted: { zIndex: 5, opacity: 0.94 },
  block: {
    flex: 1,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    paddingHorizontal: space.xs,
    paddingVertical: 4,
    overflow: 'hidden',
    gap: 1,
  },
  strike: { textDecorationLine: 'line-through' },
  now: {
    position: 'absolute',
    left: -6,
    right: 0,
    height: 10,
    marginTop: -5,
    flexDirection: 'row',
    alignItems: 'center',
  },
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
  chipSmall: { minHeight: 32, paddingHorizontal: 6, gap: 4, borderRadius: 8 },
  shrink: { flexShrink: 1 },
  weekHead: { flexDirection: 'row', paddingLeft: GUTTER },
  weekDay: {
    flex: 1,
    minWidth: 0,
    minHeight: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.input,
    paddingHorizontal: 2,
  },
  weekAllDay: {
    flexDirection: 'row',
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekAllDayLabel: { width: GUTTER, paddingRight: 6, textAlign: 'right', fontSize: 11 },
  weekAllDayCol: { flex: 1, minWidth: 0, gap: 4, paddingHorizontal: 2 },
});
