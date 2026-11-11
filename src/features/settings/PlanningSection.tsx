import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  CAPACITY_MAX_MIN,
  CAPACITY_STEP_MIN,
  clampCapacity,
  setDailyCapacity,
  setWeekStart,
  type WeekStart,
} from '../../data/settings';
import { formatClock, formatMinutes } from '../../lib/dates';
import { usePreferences } from '../../state/preferences';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { Stepper } from '../../ui/Stepper';
import { Text } from '../../ui/Text';
import { sizes, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';
import { useDataContext } from '../session/SessionProvider';
import { usePlanning } from './usePlanning';

/** Me > Planning: week start, daily capacity, the day window, and the way into the categories manager. */
export function PlanningSection() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const ctx = useDataContext();
  const prefs = usePreferences();
  const planning = usePlanning();
  const [focused, focusHandlers] = useFocusRing();
  const weeks: { value: WeekStart; label: string }[] = [
    { value: 1, label: t('settings.weekMonday') },
    { value: 0, label: t('settings.weekSunday') },
  ];
  const capacity = planning.dailyCapacityMin;
  const change = (next: number) => {
    if (ctx) void setDailyCapacity(ctx, next);
  };

  return (
    <>
      <View style={styles.block}>
        <Text variant="title3" accessibilityRole="header">
          {t('settings.weekStart')}
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.weekStart')} style={styles.pills}>
          {weeks.map((w) => (
            <Pill
              key={w.value}
              label={w.label}
              selected={planning.weekStartsOn === w.value}
              onPress={() => ctx && void setWeekStart(ctx, w.value)}
              testID={`week-start-${w.value}`}
            />
          ))}
        </View>
        <Text variant="caption" color={colors.textSecondary}>
          {t('settings.weekStartHint')}
        </Text>
      </View>

      <View style={styles.block}>
        <Text variant="title3" accessibilityRole="header">
          {t('settings.capacity')}
        </Text>
        <Stepper
          icons="plusMinus"
          label={t('settings.capacity')}
          value={formatMinutes(capacity, i18n.language)}
          previousLabel={t('settings.capacityLess')}
          nextLabel={t('settings.capacityMore')}
          onPrevious={() => change(clampCapacity(capacity - CAPACITY_STEP_MIN))}
          onNext={() => change(clampCapacity(capacity + CAPACITY_STEP_MIN))}
          canPrevious={planning.ready && capacity >= CAPACITY_STEP_MIN}
          canNext={planning.ready && capacity < CAPACITY_MAX_MIN}
          testID="capacity-stepper"
        />
        <Text variant="caption" color={colors.textSecondary}>
          {t('settings.capacityHint')}
        </Text>
      </View>

      <View style={styles.kv}>
        <Text variant="body">{t('me.dayStarts')}</Text>
        <Text variant="title3">{formatClock(prefs.dayStart, i18n.language)}</Text>
      </View>
      <View style={styles.kv}>
        <Text variant="body">{t('me.dayEnds')}</Text>
        <Text variant="title3">{formatClock(prefs.dayEnd, i18n.language)}</Text>
      </View>

      <Pressable
        {...focusHandlers}
        onPress={() => router.push('/settings/categories')}
        accessibilityRole="button"
        accessibilityLabel={t('settings.categories')}
        accessibilityHint={t('settings.categoriesHint')}
        testID="open-categories"
        style={[styles.link, { borderColor: focused ? colors.focus : 'transparent' }]}
      >
        <View style={styles.flex}>
          <Text variant="title3">{t('settings.categories')}</Text>
          <Text variant="caption" color={colors.textSecondary}>
            {t('settings.categoriesHint')}
          </Text>
        </View>
        <Icon name="chevronRight" size={20} color={colors.textSecondary} />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  block: { gap: space.xs },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, minHeight: 32 },
  link: {
    minHeight: sizes.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 2,
    borderRadius: 14,
  },
});
