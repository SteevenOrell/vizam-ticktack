import Constants from 'expo-constants';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { formatClock } from '../../lib/dates';
import { usePreferences, type LanguagePreference, type ThemePreference } from '../../state/preferences';
import { Card } from '../../ui/Card';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { Pill } from '../../ui/Pill';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
        {title}
      </Text>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

export function MeScreen() {
  const { t, i18n } = useTranslation();
  const { colors, header } = useTheme();
  const prefs = usePreferences();

  const themes: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: t('me.themeSystem') },
    { value: 'dark', label: t('me.themeDark') },
    { value: 'light', label: t('me.themeLight') },
  ];
  const languages: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t('me.languageSystem') },
    { value: 'en', label: t('me.languageEnglish') },
    { value: 'fr', label: t('me.languageFrench') },
  ];

  return (
    <HeaderScreen
      testID="screen-me"
      title={t('me.title')}
      header={
        <View style={styles.guest}>
          <Text variant="title3" color={header.on.text}>
            {t('me.guestTitle')}
          </Text>
          <Text variant="bodySm" color={header.on.textSecondary}>
            {t('me.guestBody')}
          </Text>
        </View>
      }
    >
      <Section title={t('me.appearance')}>
        <Text variant="title3">{t('me.theme')}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('me.theme')} style={styles.pills}>
          {themes.map((o) => (
            <Pill
              key={o.value}
              label={o.label}
              selected={prefs.theme === o.value}
              onPress={() => prefs.setTheme(o.value)}
            />
          ))}
        </View>
        <Text variant="title3">{t('me.language')}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('me.language')} style={styles.pills}>
          {languages.map((o) => (
            <Pill
              key={o.value}
              label={o.label}
              selected={prefs.language === o.value}
              onPress={() => prefs.setLanguage(o.value)}
            />
          ))}
        </View>
      </Section>

      <Section title={t('me.planning')}>
        <View style={styles.kv}>
          <Text variant="body">{t('me.dayStarts')}</Text>
          <Text variant="title3">{formatClock(prefs.dayStart, i18n.language)}</Text>
        </View>
        <View style={styles.kv}>
          <Text variant="body">{t('me.dayEnds')}</Text>
          <Text variant="title3">{formatClock(prefs.dayEnd, i18n.language)}</Text>
        </View>
      </Section>

      <Section title={t('me.about')}>
        <Text variant="title3">{t('app.concept')}</Text>
        <Text variant="bodySm" color={colors.textSecondary}>
          {t('me.conceptNote')}
        </Text>
        <Text variant="caption" color={colors.textTertiary}>
          {t('me.version', { version: Constants.expoConfig?.version ?? '0.0.0' })}
        </Text>
      </Section>
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  guest: { marginTop: space.md, gap: space.xxs },
  section: { gap: space.xs, marginBottom: space.xl },
  card: { gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, minHeight: 32 },
});
