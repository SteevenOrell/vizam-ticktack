import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '../../ui/Icon';
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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentText,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fontFamilies.textMedium, fontSize: 12, letterSpacing: MANROPE_TRACKING },
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
  );
}
