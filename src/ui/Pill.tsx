import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
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
}

/** Compact pill for filters and toggles. Selected state is shown by fill and a check-free bold label, never colour only. */
export function Pill({ label, selected = false, onPress, onHeader, accessibilityHint }: PillProps) {
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
      accessibilityRole={onPress ? 'radio' : undefined}
      accessibilityState={onPress ? { selected, checked: selected } : undefined}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={!onPress}
      style={() => [styles.hit, focused ? { borderColor: colors.focus } : null]}
    >
      <View style={[styles.pill, { backgroundColor: bg, borderColor: border }]}>
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
  },
});
