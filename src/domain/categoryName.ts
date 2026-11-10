/**
 * Free-text categories: name normalisation, case-insensitive matching and the automatic colour for new categories.
 */
import type { CategoryColor } from './models';

export const CATEGORY_NAME_MAX = 40;

/** Trims and collapses inner whitespace. Empty -> null. Longer than 40 characters stays long (validation rejects it). */
export function normalizeCategoryName(input: string | null | undefined): string | null {
  const s = (input ?? '').replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}

/** Key used for de-duplication: "Work", " work " and "WORK" are one category. */
export const categoryKey = (name: string) => (normalizeCategoryName(name) ?? '').toLocaleLowerCase();

/** Order new categories take their colour from: distinct hues first, the two greys last. */
export const CATEGORY_PALETTE: readonly CategoryColor[] = [
  'ember',
  'sky',
  'moss',
  'plum',
  'sand',
  'rose',
  'sage',
  'slate',
];

/** Least-used palette colour among the existing categories; ties go to the earlier colour in the palette. */
export function pickCategoryColor(used: readonly string[]): CategoryColor {
  const counts = new Map<string, number>();
  for (const c of used) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: CategoryColor = CATEGORY_PALETTE[0] as CategoryColor;
  let bestCount = Infinity;
  for (const color of CATEGORY_PALETTE) {
    const n = counts.get(color) ?? 0;
    if (n < bestCount) {
      best = color;
      bestCount = n;
    }
  }
  return best;
}

/** Suggestions for the category field: names starting with the text first, then names containing it. */
export function matchCategories<T extends { name: string }>(options: readonly T[], text: string, limit = 6): T[] {
  const q = categoryKey(text);
  if (!q) return options.slice(0, limit);
  const starts = options.filter((o) => categoryKey(o.name).startsWith(q));
  const contains = options.filter((o) => !categoryKey(o.name).startsWith(q) && categoryKey(o.name).includes(q));
  return [...starts, ...contains].slice(0, limit);
}
