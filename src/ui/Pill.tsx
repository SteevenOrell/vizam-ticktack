import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryDot } from './Checkbox';
import { Text } from './Text';
import type { CategoryColor } from './theme/colors';
import { radii, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useFocusRing } from './useFocusRing';

export interface PillProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Colours when the pill sits on a header gradient (from theme.header.on). */
  onHeader?: boolean;
  accessibilityHint?: string;
  /** `checkbox` for multi-select rows (weekdays); `radio` (default) for single choice. */
  role?: 'radio' | 'checkbox';
  /** Category colour dot before the label. */
  dot?: CategoryColor | null;
  testID?: string;
}

/** Compact pill for filters and toggles. Selected state is shown by fill and a check-free bold label, never colour only. */
export function Pill({ label, selected = false, onPress, onHeader, accessibilityHint, role, dot, testID }: PillProps) {
  const { colors, header } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const bg = selected ? (onHeader ? header.on.selectedBg : colors.accent) : onHeader ? 'transparent' : colors.chip;
  const fg = selected
    ? onHeader
      ? header.on.selectedFg
      : colors.onAccent
    : onHeader
      ? header.on.unselectedFg
      : colors.text;
  const border = onHeader && !selected ? header.on.unselectedFg : 'transparent';

  return (
    <Pressable
      {...focusHandlers}
      testID={testID}
      accessibilityRole={onPress ? (role ?? 'radio') : undefined}
      accessibilityState={onPress ? { selected, checked: selected } : undefined}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={!onPress}
      style={() => [styles.hit, focused ? { borderColor: colors.focus } : null]}
    >
      <View style={[styles.pill, { backgroundColor: bg, borderColor: border }]}>
        {dot ? <CategoryDot color={dot} ring={selected ? fg : undefined} /> : null}
        <Text variant="label" weight={selected ? 600 : 500} color={fg} align="center">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    minHeight: sizes.touch,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pill: {
    minHeight: 34,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
