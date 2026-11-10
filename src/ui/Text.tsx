import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from './theme/ThemeProvider';
import { manropeWeights, typography, type TextVariant } from './theme/typography';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
  /** Manrope weight override for small labels (Light 300 is never used below 14 pt). */
  weight?: keyof typeof manropeWeights;
  align?: TextStyle['textAlign'];
}

export function Text({ variant = 'body', color, weight, align, style, ...rest }: TextProps) {
  const theme = useTheme();
  const { maxScale, ...base } = typography[variant];
  const isManrope = base.fontFamily.startsWith('Manrope');
  let fontFamily = base.fontFamily;
  if (isManrope && weight) {
    fontFamily = base.fontSize < 14 && weight === 300 ? manropeWeights[400] : manropeWeights[weight];
  }
  return (
    <RNText
      maxFontSizeMultiplier={maxScale}
      style={[base, { fontFamily, color: color ?? theme.colors.text }, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}
