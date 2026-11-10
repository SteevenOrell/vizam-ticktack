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
        // Android 12+ only allows a centred icon on a solid colour, so the native splash is the charcoal wordmark on
        // the cream centre of the day splash; the full-bleed gradient follows in-app (src/features/splash).
        backgroundColor: '#FFF1E6',
        image: './assets/splash-wordmark.png',
        imageWidth: 288,
        resizeMode: 'contain',
      },
    ],
    'expo-sqlite',
    'expo-font',
    'expo-localization',
    'expo-secure-store',
  ],
  experiments: {
    typedRoutes: true,
  },
});
