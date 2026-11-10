import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Centered } from './Centered';
import { Icon } from './Icon';
import { Text } from './Text';
import { sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useFocusRing } from './useFocusRing';

/**
 * Pushed screen (task details, overdue, history): a bar with a back chevron and an optional action, then one
 * vertical scroll with the content centred in the text column. `title` is the screen heading; leave it out when
 * the content brings its own.
 */
export function StackScreen({
  title,
  backLabel,
  onBack,
  action,
  children,
  footer,
  testID,
}: {
  title?: string;
  backLabel: string;
  onBack: () => void;
  action?: ReactNode;
  children: ReactNode;
  /** Outside the scroll view (undo bar). */
  footer?: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [focused, focusHandlers] = useFocusRing();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} testID={testID}>
      <Centered>
        <View style={[styles.bar, { paddingTop: insets.top + space.sm }]}>
          <Pressable
            {...focusHandlers}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            style={[styles.back, { borderColor: focused ? colors.focus : 'transparent' }]}
            testID={testID ? `${testID}-back` : undefined}
          >
            <Icon name="chevronLeft" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.flex} />
          {action}
        </View>
      </Centered>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.huge + space.xxl }]}
        testID={testID ? `${testID}-scroll` : undefined}
      >
        <Centered style={styles.stack}>
          {title ? (
            <Text variant="title1" accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {children}
        </Centered>
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingBottom: space.xs,
  },
  back: {
    width: sizes.touch,
    height: sizes.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: sizes.touch / 2,
    borderWidth: 2,
  },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs },
  stack: { gap: space.lg },
});
