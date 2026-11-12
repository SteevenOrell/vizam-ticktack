import { Pressable, StyleSheet, type PressableProps } from 'react-native';

import { Icon, type IconName } from './Icon';
import { radii, sizes } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useFocusRing } from './useFocusRing';

export interface RoundActionProps extends Omit<PressableProps, 'children' | 'style'> {
  icon: IconName;
  /** Screen-reader name; required because the button shows only an icon. */
  accessibilityLabel: string;
  background?: string;
  foreground?: string;
}

/** 56 px circular action. Defaults to orange with a charcoal icon; on day headers pass the charcoal/orange pair. */
export function RoundAction({ icon, background, foreground, ...rest }: RoundActionProps) {
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const bg = background ?? colors.accent;
  const fg = foreground ?? colors.onAccent;
  return (
    <Pressable
      {...focusHandlers}
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, opacity: pressed ? 0.85 : 1, borderColor: focused ? colors.focus : 'transparent' },
      ]}
      {...rest}
    >
      <Icon name={icon} size={24} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: sizes.roundAction,
    height: sizes.roundAction,
    borderRadius: radii.round,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
