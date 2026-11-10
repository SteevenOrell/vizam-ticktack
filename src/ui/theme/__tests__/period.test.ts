import { buildTheme, resolveScheme } from '../ThemeProvider';
import { headerThemes } from '../colors';
import { periodAt } from '../period';

const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m);

describe('periodAt', () => {
  it('uses the default 06:00–19:00 day', () => {
    expect(periodAt(at(5, 59), '06:00', '19:00')).toBe('night');
    expect(periodAt(at(6, 0), '06:00', '19:00')).toBe('day');
    expect(periodAt(at(18, 59), '06:00', '19:00')).toBe('day');
    expect(periodAt(at(19, 0), '06:00', '19:00')).toBe('night');
  });

  it('follows custom day start and end', () => {
    expect(periodAt(at(7, 30), '08:00', '22:00')).toBe('night');
    expect(periodAt(at(21, 0), '08:00', '22:00')).toBe('day');
  });

  it('supports a day that crosses midnight', () => {
    expect(periodAt(at(23, 0), '20:00', '04:00')).toBe('day');
    expect(periodAt(at(3, 59), '20:00', '04:00')).toBe('day');
    expect(periodAt(at(12, 0), '20:00', '04:00')).toBe('night');
  });

  it('falls back to defaults for invalid or empty windows', () => {
    expect(periodAt(at(12, 0), '25:00', 'x')).toBe('day');
    expect(periodAt(at(22, 0), '10:00', '10:00')).toBe('night');
  });
});

describe('theme resolution', () => {
  it('maps system/dark/light preferences, defaulting to dark', () => {
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });

  it('builds all four scheme × period combinations', () => {
    expect(buildTheme('dark', 'night').header).toBe(headerThemes.dark.night);
    expect(buildTheme('light', 'day').colors.bg).toBe('#F4F1EC');
    expect(buildTheme('dark', 'day').header.header.colors).toContain('#C9480F');
  });
});
