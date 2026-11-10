import type { TextStyle } from 'react-native';

/**
 * Type scale from docs/DESIGN.md section 4. Titles and numerals use Space Grotesk; everything else uses Manrope
 * with -0.4 letter spacing. Manrope Light 300 is only used at 14 pt and above.
 */
export const fontFamilies = {
  displayMedium: 'SpaceGrotesk_500Medium',
  displaySemiBold: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  textLight: 'Manrope_300Light',
  textRegular: 'Manrope_400Regular',
  textMedium: 'Manrope_500Medium',
  textSemiBold: 'Manrope_600SemiBold',
} as const;

export const MANROPE_TRACKING = -0.4;

export type TextVariant =
  'dayFace' | 'display' | 'title1' | 'title2' | 'title3' | 'body' | 'bodySm' | 'label' | 'caption';

export interface VariantStyle extends TextStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** Upper bound for Dynamic Type scaling. */
  maxScale: number;
}

const tight = (size: number) => Math.round(size * -0.02 * 100) / 100;

export const typography: Record<TextVariant, VariantStyle> = {
  dayFace: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 72,
    lineHeight: 72,
    letterSpacing: tight(72),
    fontVariant: ['tabular-nums'],
    maxScale: 1.3,
  },
  display: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 48,
    lineHeight: 52,
    letterSpacing: tight(48),
    fontVariant: ['tabular-nums'],
    maxScale: 1.3,
  },
  title1: { fontFamily: fontFamilies.displaySemiBold, fontSize: 30, lineHeight: 34, letterSpacing: 0, maxScale: 1.6 },
  title2: { fontFamily: fontFamilies.displaySemiBold, fontSize: 22, lineHeight: 28, letterSpacing: 0, maxScale: 1.8 },
  title3: {
    fontFamily: fontFamilies.textSemiBold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: MANROPE_TRACKING,
    maxScale: 2,
  },
  body: {
    fontFamily: fontFamilies.textLight,
    fontSize: 16,
    lineHeight: 23,
    letterSpacing: MANROPE_TRACKING,
    maxScale: 2,
  },
  bodySm: {
    fontFamily: fontFamilies.textLight,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: MANROPE_TRACKING,
    maxScale: 2,
  },
  label: {
    fontFamily: fontFamilies.textMedium,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: MANROPE_TRACKING,
    maxScale: 2,
  },
  caption: {
    fontFamily: fontFamilies.textRegular,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: MANROPE_TRACKING,
    maxScale: 2,
  },
};

/** Variants that may be rendered with a heavier Manrope weight (e.g. a semibold label on a button). */
export const manropeWeights = {
  300: fontFamilies.textLight,
  400: fontFamilies.textRegular,
  500: fontFamilies.textMedium,
  600: fontFamilies.textSemiBold,
} as const;
