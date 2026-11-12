import { getLocales } from 'expo-localization';
import i18n, { changeLanguage, use as registerPlugin } from 'i18next';
import { initReactI18next } from 'react-i18next';

import type { LanguagePreference } from '../state/preferences';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const supportedLanguages = ['en', 'fr'] as const;
export type Language = (typeof supportedLanguages)[number];

export const resources = {
  en: { translation: en },
  fr: { translation: fr },
} as const;

export function deviceLanguage(): Language {
  const code = getLocales()[0]?.languageCode?.toLowerCase();
  return code === 'fr' ? 'fr' : 'en';
}

export function resolveLanguage(preference: LanguagePreference): Language {
  return preference === 'system' ? deviceLanguage() : preference;
}

let initialised = false;

export function initI18n(language: Language = deviceLanguage()) {
  if (!initialised) {
    initialised = true;
    void registerPlugin(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: 'en',
      supportedLngs: supportedLanguages,
      interpolation: { escapeValue: false }, // React already escapes
      returnNull: false,
      initAsync: false,
    });
  } else if (i18n.language !== language) {
    void changeLanguage(language);
  }
  return i18n;
}

export default i18n;
