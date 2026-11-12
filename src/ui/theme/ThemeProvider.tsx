import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { usePreferences, type ThemePreference } from '../../state/preferences';
import {
  darkPalette,
  headerThemes,
  lightPalette,
  type ColorScheme,
  type HeaderTheme,
  type Palette,
  type Period,
} from './colors';
import { periodAt } from './period';

export interface Theme {
  scheme: ColorScheme;
  period: Period;
  colors: Palette;
  header: HeaderTheme;
}

export function resolveScheme(preference: ThemePreference, system: string | null | undefined): ColorScheme {
  if (preference === 'dark' || preference === 'light') return preference;
  return system === 'light' ? 'light' : 'dark'; // dark is the default theme (DESIGN.md)
}

export function buildTheme(scheme: ColorScheme, period: Period): Theme {
  return {
    scheme,
    period,
    colors: scheme === 'dark' ? darkPalette : lightPalette,
    header: headerThemes[scheme][period],
  };
}

const ThemeContext = createContext<Theme>(buildTheme('dark', 'day'));

const MINUTE = 60_000;
const systemNow = () => new Date();

/** Re-evaluates day/night once a minute while open and whenever the app returns to the foreground. */
export function useCurrentPeriod(dayStart: string, dayEnd: string, now: () => Date = systemNow): Period {
  const [period, setPeriod] = useState<Period>(() => periodAt(now(), dayStart, dayEnd));

  useEffect(() => {
    const update = () => setPeriod(periodAt(now(), dayStart, dayEnd));
    update();
    const timer = setInterval(update, MINUTE);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [dayStart, dayEnd, now]);

  return period;
}

export function ThemeProvider({ children, override }: { children: ReactNode; override?: Partial<Theme> }) {
  const system = useColorScheme();
  const preference = usePreferences((s) => s.theme);
  const dayStart = usePreferences((s) => s.dayStart);
  const dayEnd = usePreferences((s) => s.dayEnd);
  const period = useCurrentPeriod(dayStart, dayEnd);
  const scheme = resolveScheme(preference, system);

  const value = useMemo(() => {
    const base = buildTheme(override?.scheme ?? scheme, override?.period ?? period);
    return { ...base, ...override };
  }, [scheme, period, override]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
