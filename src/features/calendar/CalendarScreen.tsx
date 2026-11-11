import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Calendar } from 'react-native-calendars';

import { getAgenda, loadByDay, type AgendaItem } from '../../data/queries/agenda';
import { useQuery } from '../../data/useQuery';
import { localDateOf, type LocalDate } from '../../domain/localDate';
import { defaultWeekStartsOn, monthTitle, shortDate } from '../../i18n/dates';
import { noonOf } from '../../lib/dates';
import { Card } from '../../ui/Card';
import { useWide } from '../../ui/Centered';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { Pill } from '../../ui/Pill';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Stepper } from '../../ui/Stepper';
import { SwipePager, type SwipePagerHandle } from '../../ui/SwipePager';
import { Text } from '../../ui/Text';
import { contentWidth, radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { fontFamilies } from '../../ui/theme/typography';
import { useDataContext } from '../session/SessionProvider';
import { isHidden, usePendingDeletes } from '../tasks/pendingDeletes';
import { TaskActionsProvider } from '../tasks/TaskActions';
import { TaskRow } from '../tasks/TaskRow';
import { applyCalendarLocale } from './calendarLocale';
import { DateStrip } from './DateStrip';
import { AllDayStrip, DayTimeline, WeekGrid } from './DayTimeline';
import { pageDirection, pageKeyOf, rangeFor, samePage, stepDate, type CalendarView, type ShownPage } from './paging';

export type { CalendarView } from './paging';

/** Rows in time order; each row's time column shows its start time and duration. */
function DayList({ items }: { items: AgendaItem[] }) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <TaskRow key={item.key} item={item} />
      ))}
    </View>
  );
}

export function CalendarScreen({
  now = new Date(),
  initialView = 'day',
  wide,
}: {
  now?: Date;
  initialView?: CalendarView;
  /** Tablet / desktop layout (week hour grid). Defaults to the window width (768 pt and up). */
  wide?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const windowWide = useWide();
  const isWide = wide ?? windowWide;
  const [notice, setNotice] = useState<string | null>(null);
  const theme = useTheme();
  const { colors } = theme;
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
  // Keep the current page on screen while the next one loads (no skeleton between pages).
  const state = useQuery(query, { keepPrevious: true });
  const pending = usePendingDeletes((s) => s.pending);
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

  // The page on screen: the live selection once its data has loaded, the previous one while it loads.
  const live: ShownPage = { view, selected, from: range.from, to: range.to };
  const [page, setPage] = useState(live);
  if (!state.stale && !samePage(page, live)) setPage(live);
  const shown = state.stale ? page : live;

  const pagerRef = useRef<SwipePagerHandle>(null);
  const turn = (dir: -1 | 1) => setSelected((d) => stepDate(view, d, dir));
  // Arrows, Today and taps that leave the page use the same slide as a swipe.
  const move = (dir: -1 | 1) => (pagerRef.current ? pagerRef.current.go(dir) : turn(dir));
  const goTo = (date: LocalDate) => {
    if (date === selected) return;
    const dir = pageDirection(view, selected, date, weekStartsOn);
    if (dir === 0 || !pagerRef.current) setSelected(date);
    else pagerRef.current.go(dir, () => setSelected(date));
  };
  const label =
    view === 'day'
      ? shortDate(noonOf(selected), lang)
      : view === 'week'
        ? `${shortDate(noonOf(range.from), lang)} – ${shortDate(noonOf(range.to), lang)}`
        : monthTitle(noonOf(selected), lang);

  return (
    <TaskActionsProvider now={now} onError={state.reload} onNotice={setNotice}>
      <HeaderScreen
        testID="screen-calendar"
        title={t('calendar.title')}
        maxWidth={isWide && shown.view === 'week' ? contentWidth.grid : undefined}
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
          {selected !== today ? <Pill label={t('calendar.today')} onPress={() => goTo(today)} /> : null}
        </View>
        {notice ? (
          <Text
            variant="bodySm"
            color={colors.danger}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={styles.notice}
            testID="calendar-notice"
          >
            {notice}
          </Text>
        ) : null}

        <AsyncContent state={state} onRetry={state.reload} isEmpty={() => false} empty={null}>
          {(all) => {
            const items = all.filter((i) => !isHidden(i, pending));
            // Everything below renders the page whose data is loaded (`shown`), never a mix of old and new.
            const sel = shown.selected;
            const pageKey = pageKeyOf(shown);
            if (shown.view === 'day') {
              const allDay = items.filter((i) => !i.startTime);
              return (
                <SwipePager
                  ref={pagerRef}
                  onPage={turn}
                  pageKey={pageKey}
                  testID="calendar-pager-day"
                  accessibilityHint={t('calendar.swipeHint_day')}
                >
                  <View style={styles.day}>
                    {items.length === 0 ? (
                      <EmptyState icon="calendar" title={t('calendar.emptyTitle')} body={t('calendar.emptyBody')} />
                    ) : null}
                    <AllDayStrip items={allDay} label={t('calendar.allDay')} />
                    {/* Scrolls itself: to now on today, otherwise an hour above the first item (8:00 if none). */}
                    <DayTimeline items={items} isToday={sel === today} now={now} dayKey={sel} />
                  </View>
                </SwipePager>
              );
            }

            if (shown.view === 'week') {
              const loads = loadByDay(items, shown.from, shown.to);
              const byDay = loads.filter((l) => l.total > 0);
              if (isWide) {
                // Tablet and desktop: seven day columns on one hour grid (scrolls itself like the day timeline).
                return (
                  <SwipePager
                    ref={pagerRef}
                    onPage={turn}
                    pageKey={pageKey}
                    testID="calendar-pager-week"
                    accessibilityHint={t('calendar.swipeHint_week')}
                  >
                    <WeekGrid
                      days={loads.map((l) => ({ date: l.date, items: items.filter((i) => i.date === l.date) }))}
                      today={today}
                      selected={sel}
                      now={now}
                      onSelect={goTo}
                      allDayLabel={t('calendar.allDay')}
                    />
                  </SwipePager>
                );
              }
              // The strip and the agenda below it move together, and the screen goes back to the top.
              return (
                <SwipePager
                  ref={pagerRef}
                  onPage={turn}
                  pageKey={pageKey}
                  resetScroll
                  testID="calendar-pager-week"
                  accessibilityHint={t('calendar.swipeHint_week')}
                >
                  <View style={styles.week}>
                    <DateStrip days={loads} selected={sel} today={today} onSelect={goTo} />
                    {byDay.length === 0 ? (
                      <EmptyState
                        icon="calendar"
                        title={t('calendar.emptyWeekTitle')}
                        body={t('calendar.emptyWeekBody')}
                      />
                    ) : (
                      byDay.map((l) => (
                        <View key={l.date} style={styles.dayBlock} testID={`week-day-${l.date}`}>
                          <Text
                            variant="label"
                            color={l.date === sel ? colors.accentText : colors.textSecondary}
                            accessibilityRole="header"
                          >
                            {shortDate(noonOf(l.date), lang)} · {t('calendar.itemCount', { count: l.total })}
                          </Text>
                          <DayList items={items.filter((i) => i.date === l.date)} />
                        </View>
                      ))
                    )}
                  </View>
                </SwipePager>
              );
            }

            // month
            const loads = loadByDay(items, shown.from, shown.to);
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
            marked[sel] = {
              ...marked[sel],
              selected: true,
              selectedColor: colors.accent,
              selectedTextColor: colors.onAccent,
            };
            const dayItems = items.filter((i) => i.date === sel);
            // The month grid and the day preview move together, and the screen goes back to the top.
            return (
              <SwipePager
                ref={pagerRef}
                onPage={turn}
                pageKey={pageKey}
                resetScroll
                testID="calendar-pager-month"
                accessibilityHint={t('calendar.swipeHint_month')}
              >
                <View style={styles.week}>
                  <Card style={styles.monthCard}>
                    <Calendar
                      key={`${lang}-${theme.scheme}-${sel.slice(0, 7)}`}
                      current={sel}
                      firstDay={weekStartsOn}
                      hideArrows
                      disableMonthChange
                      renderHeader={() => null}
                      markedDates={marked}
                      onDayPress={(d: { dateString: string }) => goTo(d.dateString)}
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
                      {shortDate(noonOf(sel), lang)} · {t('calendar.itemCount', { count: dayItems.length })}
                    </Text>
                    {dayItems.length ? (
                      <DayList items={dayItems} />
                    ) : (
                      <Text variant="bodySm" color={colors.textSecondary}>
                        {t('calendar.emptyBody')}
                      </Text>
                    )}
                  </View>
                </View>
              </SwipePager>
            );
          }}
        </AsyncContent>
      </HeaderScreen>
    </TaskActionsProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  segments: { marginTop: space.lg },
  nav: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.md },
  notice: { marginBottom: space.sm },
  list: { gap: space.xs },
  day: { gap: space.sm },
  week: { gap: space.lg },
  dayBlock: { gap: space.xs },
  monthCard: { borderRadius: radii.card, padding: space.xs },
});
