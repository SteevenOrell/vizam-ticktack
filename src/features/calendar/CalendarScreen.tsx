import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Calendar, Timeline, type TimelineEventProps } from 'react-native-calendars';

import { getAgenda, loadByDay, type AgendaItem } from '../../data/queries/agenda';
import { setDone } from '../../data/tasks';
import { useQuery } from '../../data/useQuery';
import {
  addDays,
  addMonthsClamped,
  daysInMonth,
  formatYmd,
  localDateOf,
  minutesOf,
  parseYmd,
  startOfWeek,
  type LocalDate,
} from '../../domain/localDate';
import { defaultWeekStartsOn, monthTitle, shortDate } from '../../i18n/dates';
import { formatClock, noonOf } from '../../lib/dates';
import { Card } from '../../ui/Card';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { Pill } from '../../ui/Pill';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Stepper } from '../../ui/Stepper';
import { Text } from '../../ui/Text';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { fontFamilies } from '../../ui/theme/typography';
import { useDataContext } from '../session/SessionProvider';
import { TaskRow } from '../tasks/TaskRow';
import { openItem } from '../today/TodayScreen';
import { applyCalendarLocale } from './calendarLocale';
import { DateStrip } from './DateStrip';

export type CalendarView = 'day' | 'week' | 'month';

function rangeFor(view: CalendarView, selected: LocalDate, weekStartsOn: number) {
  if (view === 'day') return { from: selected, to: selected };
  if (view === 'week') {
    const from = startOfWeek(selected, weekStartsOn);
    return { from, to: addDays(from, 6) };
  }
  const { y, m } = parseYmd(selected);
  const first = formatYmd({ y, m, d: 1 });
  const last = formatYmd({ y, m, d: daysInMonth(y, m) });
  return { from: startOfWeek(first, weekStartsOn), to: addDays(startOfWeek(last, weekStartsOn), 6) };
}

function DayList({
  items,
  onToggle,
  onOpen,
}: {
  items: AgendaItem[];
  onToggle: (item: AgendaItem, done: boolean) => void;
  onOpen: (item: AgendaItem) => void;
}) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <TaskRow key={item.key} item={item} onToggle={onToggle} onOpen={item.kind === 'routine' ? undefined : onOpen} />
      ))}
    </View>
  );
}

export function CalendarScreen({ now = new Date(), initialView = 'day' }: { now?: Date; initialView?: CalendarView }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { colors } = theme;
  const router = useRouter();
  const ctx = useDataContext();
  const lang = i18n.language;
  const today = localDateOf(now);
  const weekStartsOn = defaultWeekStartsOn(lang);
  const [view, setView] = useState<CalendarView>(initialView);
  const [selected, setSelected] = useState<LocalDate>(today);
  const ownerId = ctx?.ownerId ?? 'local';
  const range = rangeFor(view, selected, weekStartsOn);
  const query = useCallback(
    (db: Parameters<typeof getAgenda>[0]) => getAgenda(db, ownerId, range.from, range.to, today),
    [ownerId, range.from, range.to, today],
  );
  const state = useQuery(query);
  applyCalendarLocale(lang);

  const segments = useMemo(
    () =>
      [
        { value: 'day', label: t('calendar.day') },
        { value: 'week', label: t('calendar.week') },
        { value: 'month', label: t('calendar.month') },
      ] as const,
    [t],
  );

  const onToggle = useCallback(
    (item: AgendaItem, done: boolean) => {
      if (ctx) void setDone(ctx, { taskId: item.taskId, occurrenceId: item.occurrenceId }, done);
    },
    [ctx],
  );
  const onOpen = useCallback((item: AgendaItem) => openItem(router, item), [router]);

  const step = view === 'day' ? 1 : view === 'week' ? 7 : 0;
  const move = (dir: -1 | 1) => setSelected((d) => (step ? addDays(d, dir * step) : addMonthsClamped(d, dir)));
  const label =
    view === 'day'
      ? shortDate(noonOf(selected), lang)
      : view === 'week'
        ? `${shortDate(noonOf(range.from), lang)} – ${shortDate(noonOf(range.to), lang)}`
        : monthTitle(noonOf(selected), lang);

  const timelineTheme = {
    calendarBackground: colors.bg,
    timeLabel: { color: colors.textSecondary, fontFamily: fontFamilies.textRegular, fontSize: 12 },
    line: { backgroundColor: colors.border },
    verticalLine: { backgroundColor: colors.border },
    nowIndicatorLine: { backgroundColor: colors.accent },
    nowIndicatorKnob: { backgroundColor: colors.accent },
    // The library wraps renderEvent in a bordered light box; keep only positioning.
    event: { backgroundColor: 'transparent', borderWidth: 0, paddingLeft: 0, paddingTop: 0, paddingBottom: 2 },
  };

  return (
    <HeaderScreen
      testID="screen-calendar"
      title={t('calendar.title')}
      header={
        <View style={styles.segments}>
          <SegmentedControl
            segments={segments}
            value={view}
            onChange={setView}
            accessibilityLabel={t('calendar.viewLabel')}
          />
        </View>
      }
    >
      <View style={styles.nav}>
        <View style={styles.flex}>
          <Stepper
            testID="calendar-nav"
            label={t('calendar.showing')}
            value={label}
            previousLabel={t(`calendar.previous_${view}`)}
            nextLabel={t(`calendar.next_${view}`)}
            onPrevious={() => move(-1)}
            onNext={() => move(1)}
          />
        </View>
        {selected !== today ? <Pill label={t('calendar.today')} onPress={() => setSelected(today)} /> : null}
      </View>

      <AsyncContent state={state} onRetry={state.reload} isEmpty={() => false} empty={null}>
        {(items) => {
          if (view === 'day') {
            const allDay = items.filter((i) => !i.startTime);
            const timed = items.filter((i) => i.startTime);
            const events: (TimelineEventProps & { item: AgendaItem })[] = timed.map((i) => {
              const start = minutesOf(i.startTime as string);
              const end = Math.min(start + (i.durationMin ?? 30), 24 * 60 - 1);
              const at = (m: number) =>
                `${selected} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
              return { id: i.key, title: i.title, start: at(start), end: at(end), color: colors.surface, item: i };
            });
            return (
              <View>
                {items.length === 0 ? (
                  <EmptyState icon="calendar" title={t('calendar.emptyTitle')} body={t('calendar.emptyBody')} />
                ) : null}
                {allDay.length ? (
                  <View style={styles.allDay}>
                    <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                      {t('calendar.allDay')}
                    </Text>
                    <DayList items={allDay} onToggle={onToggle} onOpen={onOpen} />
                  </View>
                ) : null}
                <View style={[styles.timeline, { borderColor: colors.border }]} testID="calendar-timeline">
                  <Timeline
                    key={`${selected}-${theme.scheme}`}
                    date={selected}
                    events={events}
                    start={5}
                    end={24}
                    format24h={lang === 'fr'}
                    timelineLeftInset={64}
                    rightEdgeSpacing={space.lg}
                    showNowIndicator={selected === today}
                    scrollToFirst
                    theme={timelineTheme as never}
                    onEventPress={(e) => {
                      const hit = events.find((x) => x.id === e.id);
                      if (hit) onOpen(hit.item);
                    }}
                    renderEvent={(e) => {
                      const hit = events.find((x) => x.id === e.id);
                      const done = hit?.item.done;
                      return (
                        <View
                          style={[styles.event, { backgroundColor: colors.surface, borderLeftColor: colors.accent }]}
                          accessibilityLabel={`${e.title}, ${hit?.item.startTime ? formatClock(hit.item.startTime, lang) : ''}`}
                        >
                          <Text
                            variant="label"
                            weight={600}
                            numberOfLines={2}
                            color={done ? colors.textSecondary : colors.text}
                            style={done ? styles.strike : null}
                          >
                            {e.title}
                          </Text>
                        </View>
                      );
                    }}
                  />
                </View>
              </View>
            );
          }

          if (view === 'week') {
            const loads = loadByDay(items, range.from, range.to);
            const byDay = loads.filter((l) => l.total > 0);
            return (
              <View style={styles.week}>
                <DateStrip days={loads} selected={selected} today={today} onSelect={setSelected} />
                {byDay.length === 0 ? (
                  <EmptyState icon="calendar" title={t('calendar.emptyWeekTitle')} body={t('calendar.emptyWeekBody')} />
                ) : (
                  byDay.map((l) => (
                    <View key={l.date} style={styles.dayBlock} testID={`week-day-${l.date}`}>
                      <Text
                        variant="label"
                        color={l.date === selected ? colors.accentText : colors.textSecondary}
                        accessibilityRole="header"
                      >
                        {shortDate(noonOf(l.date), lang)} · {t('calendar.itemCount', { count: l.total })}
                      </Text>
                      <DayList items={items.filter((i) => i.date === l.date)} onToggle={onToggle} onOpen={onOpen} />
                    </View>
                  ))
                )}
              </View>
            );
          }

          // month
          const loads = loadByDay(items, range.from, range.to);
          const marked: Record<
            string,
            {
              marked?: boolean;
              dotColor?: string;
              selected?: boolean;
              selectedColor?: string;
              selectedTextColor?: string;
            }
          > = {};
          for (const l of loads) if (l.total > 0) marked[l.date] = { marked: true, dotColor: colors.accent };
          marked[selected] = {
            ...marked[selected],
            selected: true,
            selectedColor: colors.accent,
            selectedTextColor: colors.onAccent,
          };
          const dayItems = items.filter((i) => i.date === selected);
          return (
            <View style={styles.week}>
              <Card style={styles.monthCard}>
                <Calendar
                  key={`${lang}-${theme.scheme}-${selected.slice(0, 7)}`}
                  current={selected}
                  firstDay={weekStartsOn}
                  hideArrows
                  disableMonthChange
                  renderHeader={() => null}
                  markedDates={marked}
                  onDayPress={(d: { dateString: string }) => setSelected(d.dateString)}
                  theme={{
                    calendarBackground: 'transparent',
                    dayTextColor: colors.text,
                    monthTextColor: colors.text,
                    textSectionTitleColor: colors.textSecondary,
                    selectedDayBackgroundColor: colors.accent,
                    selectedDayTextColor: colors.onAccent,
                    todayTextColor: colors.accentText,
                    dotColor: colors.accent,
                    selectedDotColor: colors.onAccent,
                    textDisabledColor: colors.textTertiary,
                    textDayFontFamily: fontFamilies.textMedium,
                    textMonthFontFamily: fontFamilies.displaySemiBold,
                    textDayHeaderFontFamily: fontFamilies.textMedium,
                  }}
                />
              </Card>
              <View style={styles.dayBlock} testID="month-preview">
                <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                  {shortDate(noonOf(selected), lang)} · {t('calendar.itemCount', { count: dayItems.length })}
                </Text>
                {dayItems.length ? (
                  <DayList items={dayItems} onToggle={onToggle} onOpen={onOpen} />
                ) : (
                  <Text variant="bodySm" color={colors.textSecondary}>
                    {t('calendar.emptyBody')}
                  </Text>
                )}
              </View>
            </View>
          );
        }}
      </AsyncContent>
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  segments: { marginTop: space.lg },
  nav: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.md },
  list: { gap: space.xs },
  allDay: { gap: space.xs, marginBottom: space.md },
  // Full bleed: the Timeline sizes events from the screen width, so it must span the whole screen.
  timeline: { height: 520, marginHorizontal: -space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  event: { flex: 1, borderRadius: 10, borderLeftWidth: 3, padding: space.xs },
  strike: { textDecorationLine: 'line-through' },
  week: { gap: space.lg },
  dayBlock: { gap: space.xs },
  monthCard: { borderRadius: radii.card, padding: space.xs },
});
