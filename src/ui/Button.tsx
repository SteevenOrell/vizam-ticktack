import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radii, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useFocusRing } from './useFocusRing';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: 'large' | 'compact';
  icon?: IconName;
  fullWidth?: boolean;
}

/** Labels wrap instead of truncating (French runs ~20% longer). */
export function Button({
  label,
  variant = 'primary',
  size = 'large',
  icon,
  fullWidth,
  disabled,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const palette = {
    primary: { bg: colors.accent, fg: colors.onAccent, border: 'transparent' },
    secondary: { bg: colors.chip, fg: colors.text, border: 'transparent' },
    ghost: { bg: 'transparent', fg: colors.accentText, border: 'transparent' },
    destructive: { bg: 'transparent', fg: colors.danger, border: colors.danger },
  }[variant];

  return (
    <Pressable
      {...focusHandlers}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: size === 'large' ? sizes.buttonLarge : sizes.buttonCompact,
          paddingHorizontal: size === 'large' ? space.xl : space.md,
          backgroundColor: palette.bg,
          borderColor: focused ? colors.focus : palette.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : undefined,
        },
      ]}
      {...rest}
    >
      <View style={styles.row}>
        {icon ? <Icon name={icon} size={size === 'large' ? 22 : 18} color={palette.fg} /> : null}
        <Text
          variant={size === 'large' ? 'title3' : 'label'}
          weight={size === 'large' ? 600 : 500}
          color={palette.fg}
          align="center"
          style={styles.label}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    borderWidth: 2,
    justifyContent: 'center',
    minWidth: sizes.touch,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  label: { flexShrink: 1 },
});
