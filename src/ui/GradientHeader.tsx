import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { gradientPoints, type GradientStops } from './theme/colors';
import { motion, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useNativeDriver } from './platform';

function Gradient({ stops, style }: { stops: GradientStops; style?: ViewStyle }) {
  const { start, end } = gradientPoints(stops.angle);
  return <LinearGradient colors={stops.colors} locations={stops.locations} start={start} end={end} style={style} />;
}

/**
 * Header with the sage → orange (day) or sage → blue (night) gradient. When the period changes it cross-fades from
 * the previous gradient over 600 ms, instantly with Reduce Motion.
 */
export function GradientHeader({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { header } = useTheme();
  const insets = useSafeAreaInsets();
  const [previous, setPrevious] = useState<GradientStops | null>(null);
  const current = useRef(header.header);
  const fade = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    if (current.current === header.header) return;
    const from = current.current;
    current.current = header.header;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      setPrevious(from);
      fade.setValue(1);
      Animated.timing(fade, { toValue: 0, duration: motion.periodFade, useNativeDriver }).start(() =>
        setPrevious(null),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [header.header, fade]);

  return (
    <View style={[styles.header, { paddingTop: insets.top + space.md }, style]}>
      <Gradient stops={header.header} style={StyleSheet.absoluteFill} />
      {previous ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
          <Gradient stops={previous} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xl + sizes.deckOverlap,
    overflow: 'hidden',
  },
});
