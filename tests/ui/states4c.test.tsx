import { fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { CalendarScreen } from '../../src/features/calendar/CalendarScreen';
import { GoalsScreen } from '../../src/features/goals/GoalsScreen';
import { RoutinesScreen } from '../../src/features/routines/RoutinesScreen';
import { CategoriesScreen } from '../../src/features/settings/CategoriesScreen';
import { FailedSyncScreen } from '../../src/features/settings/FailedSyncScreen';
import { HistoryScreen } from '../../src/features/tasks/HistoryScreen';
import { OverdueScreen } from '../../src/features/tasks/OverdueScreen';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { renderWithProviders } from '../support/render';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

const NOW = new Date(2026, 10, 9, 10, 30);

async function emptyDb(): Promise<SqlDriver> {
  const db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  return db;
}

beforeEach(() => {
  useSession.setState({ status: 'guest', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
});

// Calendar keeps the timeline visible on an empty day, so it has no full-screen empty state to assert here.
const screens: { name: string; element: ReactElement; empty: boolean }[] = [
  { name: 'Today', element: <TodayScreen now={NOW} />, empty: true },
  { name: 'Calendar', element: <CalendarScreen now={NOW} />, empty: false },
  { name: 'Goals', element: <GoalsScreen now={NOW} />, empty: true },
  { name: 'Routines', element: <RoutinesScreen now={NOW} />, empty: true },
  { name: 'Overdue', element: <OverdueScreen now={NOW} />, empty: true },
  { name: 'History', element: <HistoryScreen now={NOW} />, empty: true },
  { name: 'Categories', element: <CategoriesScreen />, empty: true },
  { name: 'Failed sync', element: <FailedSyncScreen />, empty: true },
];

describe.each(screens)('$name states', ({ element, empty }) => {
  it('shows a loading skeleton while the database opens', async () => {
    await renderWithProviders(element);
    expect((await screen.findAllByTestId('state-loading')).length).toBeGreaterThan(0);
  });

  it('shows an error with a retry that recovers', async () => {
    let attempts = 0;
    await renderWithProviders(element, {
      open: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('disk unavailable');
        return emptyDb();
      },
    });
    expect(await screen.findByTestId('state-error')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId(empty ? 'state-empty' : 'calendar-timeline')).toBeTruthy();
    expect(screen.queryByTestId('state-error')).toBeNull();
  });

  it('is never blank when there is nothing to show', async () => {
    await renderWithProviders(element, { open: emptyDb });
    expect(await screen.findByTestId(empty ? 'state-empty' : 'calendar-timeline')).toBeTruthy();
  });
});
