/** Spacing, radii and motion tokens (docs/DESIGN.md section 5). */
export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const screenPadding = space.lg;

/** Window width (pt) from which the tablet / desktop layout applies (week hour grid). */
export const WIDE_BREAKPOINT = 768;

/**
 * Maximum content width on wide screens (DESIGN.md section 5): backgrounds stay full width, the content column is
 * centred. `text` for lists, forms and details; `grid` for the week hour grid, which needs the room.
 */
export const contentWidth = { text: 720, grid: 1120 } as const;

export const radii = {
  panel: 28,
  card: 20,
  input: 14,
  pill: 999,
  round: 28,
} as const;

export const sizes = {
  touch: 44,
  buttonLarge: 56,
  buttonCompact: 40,
  roundAction: 56,
  deckOverlap: 24,
} as const;

export const motion = {
  fast: 200,
  base: 240,
  slow: 280,
  periodFade: 600,
} as const;
