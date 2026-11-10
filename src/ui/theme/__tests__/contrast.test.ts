import {
  charcoal,
  darkPalette,
  headerThemes,
  lightPalette,
  splashInk,
  splashStops,
  white,
  type ColorScheme,
  type Period,
} from '../colors';
import { composite, contrastRatio, gradientSamples, mix } from '../contrast';

const AA = 4.5;
const NON_TEXT = 3;

describe('contrast helpers', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio(white, charcoal)).toBeCloseTo(17.63, 1);
    expect(contrastRatio(charcoal, '#FF7A24')).toBeCloseTo(6.77, 1);
  });

  it('mixes and composites in sRGB', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(composite('rgba(0,0,0,0.5)', '#FFFFFF')).toBe('#808080');
  });

  it('samples every stop and the midpoints between them', () => {
    expect(gradientSamples(['#000000', '#FFFFFF', '#000000'])).toEqual([
      '#000000',
      '#808080',
      '#FFFFFF',
      '#808080',
      '#000000',
    ]);
  });
});

describe('palette pairs used by the UI', () => {
  const dark = darkPalette;
  const light = lightPalette;
  const pairs: [string, string, string, number][] = [
    // [name, foreground, background, minimum]
    ['dark text/bg', dark.text, dark.bg, AA],
    ['dark text/surface', dark.text, dark.surface, AA],
    ['dark textSecondary/bg', dark.textSecondary, dark.bg, AA],
    ['dark textSecondary/surface', dark.textSecondary, dark.surface, AA],
    ['dark textTertiary/bg', dark.textTertiary, dark.bg, AA],
    ['dark textTertiary/surface', dark.textTertiary, dark.surface, AA],
    ['dark accentText/bg', dark.accentText, dark.bg, AA],
    ['dark accentText/surface', dark.accentText, dark.surface, AA],
    ['dark onAccent/accent', dark.onAccent, dark.accent, AA],
    ['dark text/chip', dark.text, dark.chip, AA],
    ['dark danger/bg', dark.danger, dark.bg, AA],
    ['dark danger/surface', dark.danger, dark.surface, AA],
    ['dark success/bg', dark.success, dark.bg, AA],
    ['dark success/surface', dark.success, dark.surface, AA],
    ['dark focus/surface', dark.focus, dark.surface, NON_TEXT],
    ['light text/bg', light.text, light.bg, AA],
    ['light text/surface', light.text, light.surface, AA],
    ['light text/surfaceMuted', light.text, light.surfaceMuted, AA],
    ['light textSecondary/bg', light.textSecondary, light.bg, AA],
    ['light textSecondary/surface', light.textSecondary, light.surface, AA],
    ['light textSecondary/surfaceMuted', light.textSecondary, light.surfaceMuted, AA],
    ['light accentText/bg', light.accentText, light.bg, AA],
    ['light accentText/surface', light.accentText, light.surface, AA],
    ['light onAccent/accent', light.onAccent, light.accent, AA],
    ['light text/chip', light.text, light.chip, AA],
    ['light danger/surface', light.danger, light.surface, AA],
    ['light success/surface', light.success, light.surface, AA],
    ['light focus/surface', light.focus, light.surface, NON_TEXT],
  ];

  it.each(pairs)('%s passes', (_name, fg, bg, min) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

describe('header and chip gradients (ends and midpoints)', () => {
  const combos: [ColorScheme, Period][] = [
    ['dark', 'day'],
    ['dark', 'night'],
    ['light', 'day'],
    ['light', 'night'],
  ];

  it.each(combos)('%s/%s header text stays AA across the gradient', (scheme, period) => {
    const { header, on } = headerThemes[scheme][period];
    for (const sample of gradientSamples(header.colors)) {
      expect(contrastRatio(on.text, sample)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(on.textSecondary, sample)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(on.unselectedFg, sample)).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(combos)('%s/%s selected state and round action are readable', (scheme, period) => {
    const { on } = headerThemes[scheme][period];
    expect(contrastRatio(on.selectedFg, on.selectedBg)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(on.actionFg, on.actionBg)).toBeGreaterThanOrEqual(AA);
  });

  it.each(combos)('%s/%s workload fill is visible on its track everywhere on the header', (scheme, period) => {
    const { header, on } = headerThemes[scheme][period];
    for (const sample of gradientSamples(header.colors)) {
      const track = composite(on.trackBg, sample);
      expect(contrastRatio(on.fill, track)).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });

  it.each(combos)('%s/%s chip text stays AA across the chip gradient', (scheme, period) => {
    const { chip } = headerThemes[scheme][period];
    const text = scheme === 'dark' ? white : charcoal;
    for (const sample of gradientSamples(chip.colors)) {
      expect(contrastRatio(text, sample)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('day headers use charcoal with orange for selected states and the round action', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const { on } = headerThemes[scheme].day;
      expect(on.selectedBg).toBe(charcoal);
      expect(on.selectedFg).toBe('#FF7A24');
      expect(on.actionBg).toBe(charcoal);
      expect(on.actionFg).toBe('#FF7A24');
    }
  });
});

describe('day header reads gray first (phase 3 feedback)', () => {
  it('keeps sage over the top half and orange only as the lower band', () => {
    const { header, chip } = headerThemes.dark.day;
    expect(header.colors[0]).toBe('#5F6F6C');
    expect(header.colors[1]).toBe('#5F6F6C');
    expect(header.locations[1]).toBeGreaterThanOrEqual(0.45);
    expect(header.colors.at(-1)).toBe('#B83D0B');
    expect(chip.locations[1]).toBeGreaterThanOrEqual(0.5);
    expect(headerThemes.light.day.header.locations[1]).toBeGreaterThanOrEqual(0.45);
  });

  it('white header text keeps at least 5:1 on every new stop and midpoint', () => {
    for (const sample of gradientSamples(headerThemes.dark.day.header.colors)) {
      expect(contrastRatio(white, sample)).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('splash', () => {
  it.each(splashStops.day)('day: charcoal wordmark, tagline and concept label on %s', (bg) => {
    expect(contrastRatio(splashInk.day.wordmark, bg)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(splashInk.day.concept, bg)).toBeGreaterThanOrEqual(AA);
  });

  it.each(gradientSamples(splashStops.day as [string, string, ...string[]]))('day midpoint %s stays AA', (bg) => {
    expect(contrastRatio(charcoal, bg)).toBeGreaterThanOrEqual(AA);
  });

  it.each(['#1E3A8A', '#2B4FB0'])('night: white wordmark and tagline on %s', (bg) => {
    expect(contrastRatio(splashInk.night.wordmark, bg)).toBeGreaterThanOrEqual(AA);
  });

  it('night: charcoal concept label on the bottom glow', () => {
    expect(contrastRatio(charcoal, '#E6F0FF')).toBeGreaterThanOrEqual(AA);
  });
});
