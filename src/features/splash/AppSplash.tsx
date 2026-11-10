import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Wordmark } from '../../ui/brand/Wordmark';
import { Text } from '../../ui/Text';
import { charcoal, white, type Period } from '../../ui/theme/colors';
import { space } from '../../ui/theme/layout';
import { useNativeDriver } from '../../ui/platform';

const backgrounds = {
  day: require('../../../assets/splash/splash-day.webp'),
  night: require('../../../assets/splash/splash-night.webp'),
} as const;

/**
 * In-app splash: the pre-rendered ember flow (day or night) with the wordmark and tagline at the exact centre.
 * Shown after the native splash (which can only be a centred image on a solid colour) until the app is ready.
 */
export function AppSplash({ period, visible, onHidden }: { period: Period; visible: boolean; onHidden?: () => void }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const opacity = useState(() => new Animated.Value(1))[0];

  useEffect(() => {
    if (visible) return;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        onHidden?.();
        return;
      }
      Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver }).start(() => onHidden?.());
    });
    return () => {
      cancelled = true;
    };
  }, [visible, opacity, onHidden]);

  const wordmarkWidth = Math.min(width * 0.75, 380);

  return (
    <Animated.View
      testID="app-splash"
      accessible
      accessibilityLabel={t('app.splashLabel')}
      accessibilityRole="image"
      style={[StyleSheet.absoluteFill, styles.root, { opacity }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Image source={backgrounds[period]} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} />
      <View style={styles.centre}>
        <Wordmark width={wordmarkWidth} />
        <Text variant="label" weight={400} color={white} align="center" style={styles.tagline}>
          {t('app.tagline')}
        </Text>
      </View>
      <Text
        variant="caption"
        weight={500}
        color={charcoal}
        align="center"
        style={[styles.concept, { bottom: insets.bottom + space.xl }]}
      >
        {t('app.concept')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: charcoal, zIndex: 10 },
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  tagline: { marginTop: 8, fontSize: 13 },
  concept: { position: 'absolute', left: space.lg, right: space.lg },
});
