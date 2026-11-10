import { addMinutes, format, parse } from 'date-fns';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Calendar, Timeline, type TimelineEventProps } from 'react-native-calendars';

import { getTasksOn } from '../../data/queries/overview';
import { useQuery } from '../../data/useQuery';
import { localDate } from '../../lib/dates';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { fontFamilies } from '../../ui/theme/typography';
import { applyCalendarLocale } from './calendarLocale';

type View3 = 'day' | 'week' | 'month';

export function CalendarScreen({ now = new Date() }: { now?: Date }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { colors } = theme;
  const [view, setView] = useState<View3>('day');
  const date = localDate(now);
  const query = useCallback((db: Parameters<typeof getTasksOn>[0]) => getTasksOn(db, date), [date]);
  const state = useQuery(query);
  applyCalendarLocale(i18n.language);

  const segments = useMemo(
    () =>
      [
        { value: 'day', label: t('calendar.day') },
        { value: 'week', label: t('calendar.week') },
        { value: 'month', label: t('calendar.month') },
      ] as const,
    [t],
  );

  const timelineTheme = {
    calendarBackground: colors.bg,
    timeLabel: { color: colors.textSecondary, fontFamily: fontFamilies.textRegular, fontSize: 12 },
    line: { backgroundColor: colors.border },
    verticalLine: { backgroundColor: colors.border },
    nowIndicatorLine: { backgroundColor: colors.accent },
    nowIndicatorKnob: { backgroundColor: colors.accent },
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
      {view === 'day' ? (
        <AsyncContent state={state} onRetry={state.reload} isEmpty={() => false} empty={null}>
          {(rows) => {
            const events: TimelineEventProps[] = rows.map((r) => {
              const start = parse(`${date} ${r.start_time}`, 'yyyy-MM-dd HH:mm', now);
              return {
                id: r.id,
                title: r.title,
                start: format(start, 'yyyy-MM-dd HH:mm:ss'),
                end: format(addMinutes(start, r.duration_min ?? 30), 'yyyy-MM-dd HH:mm:ss'),
                color: colors.surface,
              };
            });
            return (
              <View>
                {events.length === 0 ? (
                  <EmptyState icon="calendar" title={t('calendar.emptyTitle')} body={t('calendar.emptyBody')} />
                ) : null}
                <View style={[styles.timeline, { borderColor: colors.border }]} testID="calendar-timeline">
                  <Timeline
                    date={date}
                    events={events}
                    start={5}
                    end={23}
                    format24h={i18n.language === 'fr'}
                    showNowIndicator
                    scrollToFirst
                    theme={timelineTheme as never}
                    renderEvent={(e) => (
                      <View style={[styles.event, { backgroundColor: colors.surface, borderLeftColor: colors.accent }]}>
                        <Text variant="label" weight={600} numberOfLines={2}>
                          {e.title}
                        </Text>
                      </View>
                    )}
                  />
                </View>
              </View>
            );
          }}
        </AsyncContent>
      ) : null}
      {view === 'week' ? <EmptyState icon="calendar" title={t('calendar.week')} body={t('states.comingSoon')} /> : null}
      {view === 'month' ? (
        <Calendar
          key={`${i18n.language}-${theme.scheme}`}
          current={date}
          firstDay={i18n.language === 'fr' ? 1 : 0}
          markedDates={{ [date]: { selected: true } }}
          theme={{
            calendarBackground: colors.bg,
            dayTextColor: colors.text,
            monthTextColor: colors.text,
            textSectionTitleColor: colors.textSecondary,
            selectedDayBackgroundColor: colors.accent,
            selectedDayTextColor: colors.onAccent,
            todayTextColor: colors.accentText,
            arrowColor: colors.accentText,
            textDisabledColor: colors.textTertiary,
            textDayFontFamily: fontFamilies.textMedium,
            textMonthFontFamily: fontFamilies.displaySemiBold,
            textDayHeaderFontFamily: fontFamilies.textMedium,
          }}
          style={{ borderRadius: radii.card }}
        />
      ) : null}
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  segments: { marginTop: space.lg },
  timeline: { height: 480, borderRadius: radii.card, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  event: { flex: 1, borderRadius: 10, borderLeftWidth: 3, padding: space.xs },
});
