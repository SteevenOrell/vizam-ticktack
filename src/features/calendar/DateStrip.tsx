import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DayLoad } from '../../data/queries/agenda';
import { parseYmd, weekdayOf, type LocalDate } from '../../domain/localDate';
import { shortDate, weekdayNames } from '../../i18n/dates';
import { noonOf } from '../../lib/dates';
import { Text } from '../../ui/Text';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';

function DayCell({
  load,
  selected,
  isToday,
  onPress,
}: {
  load: DayLoad;
  selected: boolean;
  isToday: boolean;
  onPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const names = weekdayNames(i18n.language);
  const dots = Math.min(3, load.total);
  const fg = selected ? colors.onAccent : colors.text;
  return (
    <Pressable
      {...focusHandlers}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${shortDate(noonOf(load.date), i18n.language)}, ${t('calendar.itemCount', { count: load.total })}`}
      style={[
        styles.cell,
        {
          backgroundColor: selected ? colors.accent : colors.surface,
          borderColor: focused ? colors.focus : isToday && !selected ? colors.accent : 'transparent',
        },
      ]}
      testID={`strip-${load.date}`}
    >
      <Text variant="caption" color={selected ? colors.onAccent : colors.textSecondary} align="center">
        {names[weekdayOf(load.date)]}
      </Text>
      <Text variant="title2" color={fg} align="center" style={styles.num}>
        {parseYmd(load.date).d}
      </Text>
      <View style={styles.dots}>
        {Array.from({ length: dots }, (_, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: selected ? colors.onAccent : colors.accent }]} />
        ))}
      </View>
    </Pressable>
  );
}

/** Horizontal week selector with big numerals and completion dots (DESIGN.md section 6, DateStrip). */
export function DateStrip({
  days,
  selected,
  today,
  onSelect,
}: {
  days: DayLoad[];
  selected: LocalDate;
  today: LocalDate;
  onSelect: (date: LocalDate) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.strip} accessibilityRole="tablist" accessibilityLabel={t('calendar.weekStrip')}>
      {days.map((load) => (
        <DayCell
          key={load.date}
          load={load}
          selected={load.date === selected}
          isToday={load.date === today}
          onPress={() => onSelect(load.date)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 4 },
  cell: {
    flex: 1,
    minWidth: 0,
    minHeight: 76,
    borderRadius: radii.input,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xs,
    gap: 2,
  },
  num: { fontVariant: ['tabular-nums'] },
  dots: { flexDirection: 'row', gap: 3, height: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
