import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radii, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useNativeDriver } from './platform';

/** Loading placeholder blocks. Pulses unless Reduce Motion is on. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const opacity = useState(() => new Animated.Value(0.6))[0];

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver }),
          Animated.timing(opacity, { toValue: 0.6, duration: 700, useNativeDriver }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('states.loading')}
      testID="state-loading"
      style={styles.skeleton}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Animated.View
          key={i}
          style={[styles.block, { backgroundColor: colors.skeleton, opacity, width: i === lines - 1 ? '60%' : '100%' }]}
        />
      ))}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
}) {
  const { colors } = useTheme();
  return (
    <View testID="state-empty" style={styles.centered}>
      <View style={[styles.iconCircle, { backgroundColor: colors.surface }]}>
        <Icon name={icon} size={28} color={colors.accentText} />
      </View>
      <Text variant="title2" align="center" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="body" color={colors.textSecondary} align="center" style={styles.body}>
        {body}
      </Text>
      {action ? <Button label={action.label} onPress={action.onPress} icon={action.icon ?? 'plus'} /> : null}
    </View>
  );
}

/** `actionLabel` replaces "Try again" when the way out is not a retry (an editor whose item is gone offers "Close"). */
export function ErrorState({
  onRetry,
  message,
  actionLabel,
}: {
  onRetry: () => void;
  message?: string;
  actionLabel?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View testID="state-error" accessibilityLiveRegion="polite" style={styles.centered}>
      <View style={[styles.iconCircle, { backgroundColor: colors.surface }]}>
        <Icon name="alert" size={28} color={colors.danger} />
      </View>
      <Text variant="title2" align="center" accessibilityRole="header">
        {t('states.errorTitle')}
      </Text>
      <Text variant="body" color={colors.textSecondary} align="center" style={styles.body}>
        {message ?? t('states.errorBody')}
      </Text>
      <Button
        label={actionLabel ?? t('states.retry')}
        variant="secondary"
        icon={actionLabel ? undefined : 'refresh'}
        onPress={onRetry}
        testID="state-error-action"
      />
    </View>
  );
}

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'success'; data: T };

/** Renders the right state for an async query: skeleton, error with retry, empty, or content. */
export function AsyncContent<T>({
  state,
  onRetry,
  isEmpty,
  empty,
  children,
}: {
  state: AsyncState<T>;
  onRetry: () => void;
  isEmpty: (data: T) => boolean;
  empty: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') return <Skeleton />;
  if (state.status === 'error') return <ErrorState onRetry={onRetry} />;
  if (isEmpty(state.data)) return <>{empty}</>;
  return <View testID="state-success">{children(state.data)}</View>;
}

const styles = StyleSheet.create({
  skeleton: { gap: space.sm, paddingVertical: space.md },
  block: { height: 56, borderRadius: radii.card },
  centered: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.md, gap: space.sm },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  body: { marginBottom: space.sm, maxWidth: 320 },
});
