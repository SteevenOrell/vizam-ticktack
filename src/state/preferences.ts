import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_DAY_END, DEFAULT_DAY_START } from '../ui/theme/period';

/**
 * Device preferences. Phase 2 keeps them on the device (AsyncStorage / localStorage on web). Phase 3 mirrors
 * theme and day start/end into the synced `profile` row; language stays per device.
 */
export const themePreferenceSchema = z.enum(['system', 'dark', 'light']);
export const languagePreferenceSchema = z.enum(['system', 'en', 'fr']);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);

export const preferencesSchema = z.object({
  theme: themePreferenceSchema,
  language: languagePreferenceSchema,
  dayStart: hhmm,
  dayEnd: hhmm,
  /** Onboarding finished on this device (guest or account). */
  onboardingDone: z.boolean(),
});

export type Preferences = z.infer<typeof preferencesSchema>;
export type ThemePreference = Preferences['theme'];
export type LanguagePreference = Preferences['language'];

export const defaultPreferences: Preferences = {
  theme: 'system',
  language: 'system',
  dayStart: DEFAULT_DAY_START,
  dayEnd: DEFAULT_DAY_END,
  onboardingDone: false,
};

interface PreferencesState extends Preferences {
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (language: LanguagePreference) => void;
  setDayWindow: (dayStart: string, dayEnd: string) => void;
  setOnboardingDone: (done: boolean) => void;
}

export const PREFERENCES_STORAGE_KEY = 'ticktack.preferences';

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      ...defaultPreferences,
      setTheme: (theme) => set({ theme: themePreferenceSchema.parse(theme) }),
      setLanguage: (language) => set({ language: languagePreferenceSchema.parse(language) }),
      setDayWindow: (dayStart, dayEnd) => set({ dayStart: hhmm.parse(dayStart), dayEnd: hhmm.parse(dayEnd) }),
      setOnboardingDone: (onboardingDone) => set({ onboardingDone }),
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ theme, language, dayStart, dayEnd, onboardingDone }) => ({
        theme,
        language,
        dayStart,
        dayEnd,
        onboardingDone,
      }),
      // Stored data is untrusted: keep only valid fields, fall back to defaults otherwise.
      merge: (persisted, current) => {
        const parsed = preferencesSchema.partial().safeParse(persisted);
        return parsed.success ? { ...current, ...parsed.data } : current;
      },
    },
  ),
);
