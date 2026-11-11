import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Display name lives here and in src/i18n/locales/*.json (`app.name`). A rename only touches those three places
 * (plus `slug`/`scheme` if the store identity changes).
 */
const APP_NAME = 'TickTack';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: 'ticktack',
  // EAS builds live under the VIZAM Expo account (Steeven's choice, 2026-11-11).
  owner: 'vizam',
  scheme: 'ticktack',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#17191B',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.vizam.ticktack',
  },
  android: {
    package: 'com.vizam.ticktack',
    adaptiveIcon: {
      backgroundColor: '#17191B',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Exact reminder times (Steeven's decision, phase 4b): user-granted from the in-app explanation; reminders fall
    // back to approximate delivery without it. USE_EXACT_ALARM is not used (Play limits it to alarm-clock apps).
    permissions: ['android.permission.SCHEDULE_EXACT_ALARM'],
  },
  web: {
    favicon: './assets/favicon.png',
    output: 'single',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        // Android 12+ only allows a centred icon on a solid colour, so the native splash is the logo alone on charcoal
        // (the same on iOS and in dark mode); the in-app splash (src/features/splash) takes over at the exact same
        // position and adds the "TickTack" wordmark. The 200-unit logo box is 62% of the 288 dp image.
        backgroundColor: '#17191B',
        image: './assets/splash-icon.png',
        imageWidth: 288,
        resizeMode: 'contain',
        dark: { backgroundColor: '#17191B', image: './assets/splash-icon.png' },
      },
    ],
    'expo-sqlite',
    'expo-font',
    'expo-localization',
    'expo-secure-store',
    // Local goal reminders only (no remote push, so no APNs entitlement). See src/services/notifications.
    ['expo-notifications', { color: '#FF7A24', enableRemoteNotifications: false }],
    // Periodic upkeep while the app is closed: tops up the reminder window, then syncs.
    // See src/services/background/maintenanceTask.ts.
    'expo-background-task',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    ...config.extra,
    eas: { projectId: '723e9099-62d2-45cf-b893-581e504c9447' },
  },
});
