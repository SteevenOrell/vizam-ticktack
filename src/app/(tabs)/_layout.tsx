import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UndoSnackbar } from '../../features/tasks/UndoSnackbar';

import { usePreferences } from '../../state/preferences';
import { Icon, type IconName } from '../../ui/Icon';
import { space } from '../../ui/theme/layout';
import { fontFamilies, MANROPE_TRACKING } from '../../ui/theme/typography';
import { useTheme } from '../../ui/theme/ThemeProvider';

const tabs: {
  name: string;
  title: 'tabs.today' | 'tabs.calendar' | 'tabs.goals' | 'tabs.routines' | 'tabs.me';
  icon: IconName;
}[] = [
  { name: 'index', title: 'tabs.today', icon: 'today' },
  { name: 'calendar', title: 'tabs.calendar', icon: 'calendar' },
  { name: 'goals', title: 'tabs.goals', icon: 'goals' },
  { name: 'routines', title: 'tabs.routines', icon: 'routines' },
  { name: 'me', title: 'tabs.me', icon: 'me' },
];

export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, space.xs);
  const onboardingDone = usePreferences((s) => s.onboardingDone);
  // First run: onboarding (guest or account) before the tabs.
  if (!onboardingDone) return <Redirect href="/onboarding" />;
  const tabBarHeight = 62 + bottom;
  return (
    <View style={styles.flex}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accentText,
          tabBarInactiveTintColor: colors.textSecondary,
          // Explicit height: Manrope's line box is taller than the system font the default height assumes.
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: tabBarHeight,
            paddingTop: 6,
            paddingBottom: bottom,
          },
          tabBarLabelStyle: {
            fontFamily: fontFamilies.textMedium,
            fontSize: 12,
            lineHeight: 20,
            letterSpacing: MANROPE_TRACKING,
          },
          tabBarAllowFontScaling: true,
        }}
      >
        {tabs.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.title),
              tabBarAccessibilityLabel: t(tab.title),
              tabBarIcon: ({ color }) => <Icon name={tab.icon} color={String(color)} size={24} />,
            }}
          />
        ))}
      </Tabs>
      {/* Above the tab bar and the floating add button. */}
      <UndoSnackbar bottom={tabBarHeight + space.lg + 56 + space.sm} />
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
