/**
 * Colour tokens from docs/DESIGN.md section 3. Values here are the single source of truth for the app;
 * tests/ui/contrast.test.ts asserts every text/background pair that the UI actually uses.
 */

export type ColorScheme = 'dark' | 'light';
export type Period = 'day' | 'night';

export const charcoal = '#17191B';
export const orange = '#FF7A24';
export const white = '#FFFFFF';

export interface Palette {
  bg: string;
  surface: string;
  surfaceMuted: string;
  chip: string;
  accent: string;
  onAccent: string;
  /** Orange used for text and icons on the plain background/surface. */
  accentText: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  danger: string;
  success: string;
  border: string;
  /** Focus ring and input outline when focused (3:1 against the surface). */
  focus: string;
  skeleton: string;
}

export const darkPalette: Palette = {
  bg: '#17191B',
  surface: '#25282A',
  surfaceMuted: '#70807D',
  chip: '#4E5B58',
  accent: orange,
  onAccent: charcoal,
  accentText: orange,
  text: white,
  textSecondary: '#B9C2C0',
  textTertiary: '#8A9491',
  danger: '#FF5A4E',
  success: '#4FD1A5',
  border: 'rgba(255,255,255,0.08)',
  focus: orange,
  skeleton: '#33373A',
};

export const lightPalette: Palette = {
  bg: '#F4F1EC',
  surface: '#FFFFFF',
  surfaceMuted: '#E3E8E6',
  chip: '#DCE3E1',
  accent: orange,
  onAccent: charcoal,
  accentText: '#B34700',
  text: charcoal,
  textSecondary: '#5A6664',
  // Light theme has no separate tertiary in DESIGN.md; secondary keeps AA on bg and white.
  textTertiary: '#5A6664',
  danger: '#C0352B',
  success: '#1C7F5A',
  border: 'rgba(23,25,27,0.10)',
  focus: '#B34700',
  skeleton: '#E6E2DB',
};

export interface GradientStops {
  colors: readonly [string, string, ...string[]];
  locations: readonly [number, number, ...number[]];
  /** CSS-style angle in degrees, converted to start/end points by `gradientPoints`. */
  angle: number;
}

/**
 * Colours used for content sitting on a header gradient. On day headers the bottom is orange, so selected
 * states and the round action switch to charcoal with orange (DESIGN.md section 3, "Day orange").
 */
export interface OnHeader {
  text: string;
  textSecondary: string;
  selectedBg: string;
  selectedFg: string;
  unselectedFg: string;
  actionBg: string;
  actionFg: string;
  trackBg: string;
  fill: string;
}

export interface HeaderTheme {
  header: GradientStops;
  chip: GradientStops;
  on: OnHeader;
}

const sageDark = '#5F6F6C';
const sageLight = '#E3E8E6';

export const headerThemes: Record<ColorScheme, Record<Period, HeaderTheme>> = {
  dark: {
    day: {
      // Gray first: sage holds the top half, a warm gray-brown bridges, orange is only the lower band.
      header: {
        colors: [sageDark, sageDark, '#6E5A4E', '#9A4418', '#B83D0B'],
        locations: [0, 0.48, 0.7, 0.88, 1],
        angle: 165,
      },
      chip: { colors: ['#4E5B58', '#4E5B58', '#8A3E14'], locations: [0, 0.5, 1], angle: 135 },
      on: {
        text: white,
        textSecondary: white,
        selectedBg: charcoal,
        selectedFg: orange,
        unselectedFg: white,
        actionBg: charcoal,
        actionFg: orange,
        trackBg: 'rgba(23,25,27,0.35)',
        fill: white,
      },
    },
    night: {
      header: { colors: [sageDark, '#3F5F8A'], locations: [0, 1], angle: 165 },
      chip: { colors: ['#4E5B58', '#3E4F6B'], locations: [0, 1], angle: 135 },
      on: {
        text: white,
        textSecondary: white,
        selectedBg: orange,
        selectedFg: charcoal,
        unselectedFg: white,
        actionBg: orange,
        actionFg: charcoal,
        trackBg: 'rgba(23,25,27,0.35)',
        fill: orange,
      },
    },
  },
  light: {
    day: {
      header: { colors: [sageLight, sageLight, '#EDE3DA', '#FFDCC4'], locations: [0, 0.5, 0.78, 1], angle: 165 },
      chip: { colors: ['#DCE3E1', '#DCE3E1', '#F2D3BD'], locations: [0, 0.5, 1], angle: 135 },
      on: {
        text: charcoal,
        textSecondary: '#5A6664',
        selectedBg: charcoal,
        selectedFg: orange,
        unselectedFg: charcoal,
        actionBg: charcoal,
        actionFg: orange,
        trackBg: 'rgba(23,25,27,0.15)',
        fill: charcoal,
      },
    },
    night: {
      header: { colors: [sageLight, '#D6E2F2'], locations: [0, 1], angle: 165 },
      chip: { colors: ['#DCE3E1', '#CCD8EA'], locations: [0, 1], angle: 135 },
      on: {
        text: charcoal,
        textSecondary: '#5A6664',
        selectedBg: charcoal,
        selectedFg: white,
        unselectedFg: charcoal,
        actionBg: orange,
        actionFg: charcoal,
        trackBg: 'rgba(23,25,27,0.15)',
        fill: charcoal,
      },
    },
  },
};

/**
 * Splash stops (DESIGN.md section 3, Splash), rendered to images by scripts/render-brand.mjs. Day is a light
 * white -> orange gradient (charcoal wordmark); night keeps the dark blue ember flow (white wordmark).
 */
/** Wordmark, tagline and concept-label colours per splash. */
export const splashInk: Record<Period, { wordmark: string; tagline: string; concept: string }> = {
  day: { wordmark: charcoal, tagline: charcoal, concept: charcoal },
  night: { wordmark: white, tagline: white, concept: charcoal },
};

export const splashStops: Record<Period, readonly string[]> = {
  day: ['#FFFFFF', '#FFF1E6', '#FFC9A1', '#FF7A24'],
  night: ['#0B0B0C', '#17191B', '#1E3A8A', '#2B4FB0', '#5B8FD6', '#9DBEEA', '#E6F0FF'],
};

export const categoryColors = {
  ember: '#FF7A24',
  sage: '#70807D',
  sky: '#5AA9E6',
  plum: '#A77BD8',
  moss: '#7DB46C',
  sand: '#D9B26F',
  rose: '#E57A8F',
  slate: '#8E9AAF',
} as const;

export type CategoryColor = keyof typeof categoryColors;

/** Convert a CSS linear-gradient angle into expo-linear-gradient start/end points (unit square). */
export function gradientPoints(angle: number): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    start: { x: round(0.5 - dx), y: round(0.5 - dy) },
    end: { x: round(0.5 + dx), y: round(0.5 + dy) },
  };
}
