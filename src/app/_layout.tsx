import { Manrope_300Light } from '@expo-google-fonts/manrope/300Light';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DatabaseProvider, useDatabase } from '../data/DatabaseProvider';
import { openExpoDriver } from '../data/db/expoDriver';
import { migrate } from '../data/db/migrate';
import { devWebFlag, maybeSeedDemo } from '../data/devSeed';
import { SessionProvider, useDataContext } from '../features/session/SessionProvider';
import { AppSplash } from '../features/splash/AppSplash';
import '../services/background/defineTasks';
import { getFirebase } from '../services/firebase';
import { useGoalMaintenance } from '../services/notifications/useGoalMaintenance';
import i18n, { initI18n, resolveLanguage } from '../i18n';
import { usePreferences } from '../state/preferences';
import { ThemeProvider, useTheme } from '../ui/theme/ThemeProvider';
import { installWebLayoutRules } from '../ui/webLayout';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 300, fade: true });

initI18n();
installWebLayoutRules();

const MIN_SPLASH_MS = 1200;

async function openDatabase() {
  const db = await openExpoDriver();
  // Dev web only (?demo=1): migrate early and fill with synthetic data before screens query.
  if (devWebFlag('demo')) {
    await migrate(db);
    await maybeSeedDemo(db, resolveLanguage(usePreferences.getState().language));
  }
  return db;
}

function useHydratedPreferences(): boolean {
  const [hydrated, setHydrated] = useState(() => usePreferences.persist.hasHydrated());
  useEffect(() => {
    const unsub = usePreferences.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);
  return hydrated;
}

function LanguageSync() {
  const language = usePreferences((s) => s.language);
  useEffect(() => {
    initI18n(resolveLanguage(language));
  }, [language]);
  return null;
}

/** Goal history and the rolling reminder window (start, foreground, after changes). */
function GoalMaintenance() {
  useGoalMaintenance(useDataContext());
  return null;
}

function AppShell() {
  const theme = useTheme();
  const database = useDatabase();
  const [minElapsed, setMinElapsed] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const holdSplash = devWebFlag('holdSplash');

  useEffect(() => {
    // The in-app splash is on screen now: hand over from the native splash.
    SplashScreen.hide();
    // Initialise Firebase only when configured (.env or emulator); without config the app stays in guest mode.
    getFirebase();
    const timer = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = database.status !== 'opening' && minElapsed && !holdSplash;
  const onHidden = useCallback(() => setSplashGone(true), []);

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style={splashGone ? (theme.scheme === 'dark' ? 'light' : 'dark') : 'light'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="task/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="task/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="task/details/[id]" />
        <Stack.Screen name="overdue" />
        <Stack.Screen name="history" />
        <Stack.Screen name="goal/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="goal/[id]" />
        <Stack.Screen name="goal/edit/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="routine/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="routine/[id]" />
        <Stack.Screen name="routine/edit/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="account/delete" options={{ presentation: 'modal' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <GoalMaintenance />
      {splashGone ? null : <AppSplash visible={!ready} onHidden={onHidden} />}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_300Light,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
  });
  const hydrated = useHydratedPreferences();

  // Keep the native splash until fonts and preferences are ready; a font error falls back to system fonts.
  if ((!fontsLoaded && !fontError) || !hydrated) return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <I18nextProvider i18n={i18n}>
          <LanguageSync />
          <ThemeProvider>
            <DatabaseProvider open={openDatabase}>
              <SessionProvider>
                <AppShell />
              </SessionProvider>
            </DatabaseProvider>
          </ThemeProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
