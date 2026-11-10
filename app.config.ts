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
    [
      'expo-router',
      {
        // expo-sqlite on web needs SharedArrayBuffer, which needs cross-origin isolation.
        headers: {
          'Cross-Origin-Embedder-Policy': 'credentialless',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      },
    ],
    [
      'expo-splash-screen',
      {
        // Android 12+ only allows a centred icon on a solid colour, so the native splash is the wordmark on the
        // charcoal top of the ember flow; the full-bleed ember image follows in-app (src/features/splash).
        backgroundColor: '#17191B',
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
