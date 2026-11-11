import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text as RNText, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LogoMark, logoCream } from '../../ui/brand/LogoMark';
import { charcoal } from '../../ui/theme/colors';
import { fontFamilies } from '../../ui/theme/typography';
import { useNativeDriver } from '../../ui/platform';

/**
 * Native splash image (assets/splash-icon.png) numbers, see scripts/render-brand.mjs: the image is shown 288 dp wide
 * and the 200-unit mark box is 62% of it. The bullseye is the exact screen centre in both splashes, so the hand-over
 * does not jump.
 */
const NATIVE_IMAGE_WIDTH = 288;
export const SPLASH_LOGO_SIZE = NATIVE_IMAGE_WIDTH * 0.62;
const WORDMARK_GAP = 14;

/**
 * In-app splash: solid charcoal, the mark at the exact centre, "TickTack" under it (Space Grotesk, cream, -0.4
 * tracking). Shown after the native splash (a centred image on the same charcoal) until the app is ready.
 */
export function AppSplash({ visible, onHidden }: { visible: boolean; onHidden?: () => void }) {
  const { t } = useTranslation();
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

  return (
    <Animated.View
      testID="app-splash"
      accessible
      accessibilityLabel={t('app.splashLabel')}
      accessibilityRole="image"
      style={[StyleSheet.absoluteFill, styles.root, { opacity }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.centre}>
        <LogoMark size={SPLASH_LOGO_SIZE} />
        <RNText
          style={styles.wordmark}
          maxFontSizeMultiplier={1}
          numberOfLines={1}
          allowFontScaling={false}
          testID="app-splash-wordmark"
        >
          TickTack
        </RNText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 10, backgroundColor: charcoal },
  // The logo box is centred; the wordmark hangs below it without moving the logo.
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  wordmark: {
    position: 'absolute',
    top: '50%',
    marginTop: SPLASH_LOGO_SIZE / 2 + WORDMARK_GAP,
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.4,
    color: logoCream,
    textAlign: 'center',
  },
});
