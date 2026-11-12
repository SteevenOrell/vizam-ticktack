import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useKeyboardReveal } from './keyboard';
import { Text } from './Text';
import { radii, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { fontFamilies, MANROPE_TRACKING } from './theme/typography';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Inline error (already translated). Announced to screen readers. */
  error?: string | null;
  hint?: string;
  large?: boolean;
  testID?: string;
}

/** Labelled input with a 3:1 focus outline and an inline error line (DESIGN.md: radius 14, Manrope body). */
export function TextField({ label, error, hint, large, multiline, testID, onFocus, onBlur, ...rest }: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const reveal = useKeyboardReveal();
  const borderColor = error ? colors.danger : focused ? colors.focus : colors.border;
  return (
    <View style={styles.wrap}>
      <Text variant="label" color={colors.textSecondary}>
        {label}
      </Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          // Keep the field (and its group, see RevealTarget) above the keyboard.
          reveal();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor,
            fontFamily: large ? fontFamilies.textSemiBold : fontFamilies.textLight,
            fontSize: large ? 20 : 16,
            lineHeight: large ? 26 : 23,
            minHeight: multiline ? 96 : sizes.buttonLarge - 4,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
      {error ? (
        <Text
          variant="caption"
          color={colors.danger}
          accessibilityLiveRegion="polite"
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color={colors.textTertiary}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xxs },
  input: {
    borderWidth: 2,
    borderRadius: radii.input,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    letterSpacing: MANROPE_TRACKING,
  },
});
