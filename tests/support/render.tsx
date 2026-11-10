import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DatabaseProvider } from '../../src/data/DatabaseProvider';
import type { SqlDriver } from '../../src/data/db/driver';
import i18n, { initI18n, type Language } from '../../src/i18n';
import { ThemeProvider, type Theme } from '../../src/ui/theme/ThemeProvider';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

export async function renderWithProviders(
  ui: ReactElement,
  {
    open,
    language = 'en',
    theme,
  }: { open?: () => Promise<SqlDriver>; language?: Language; theme?: Partial<Theme> } = {},
) {
  initI18n(language);
  const opener = open ?? (() => new Promise<SqlDriver>(() => undefined)); // stays "opening"
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider override={theme}>
          <DatabaseProvider open={opener}>{ui}</DatabaseProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>,
  );
}
