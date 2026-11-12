import { fireEvent, screen } from '@testing-library/react-native';
import { randomUUID } from 'crypto';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { buildDemoData, insertDemoData } from '../../src/data/seed/demoData';
import { CalendarScreen } from '../../src/features/calendar/CalendarScreen';
import { GoalsScreen } from '../../src/features/goals/GoalsScreen';
import { MeScreen } from '../../src/features/settings/MeScreen';
import { RoutinesScreen } from '../../src/features/routines/RoutinesScreen';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { usePreferences } from '../../src/state/preferences';
import { charcoal, orange } from '../../src/ui/theme/colors';
import { renderWithProviders } from '../support/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));

const NOW = new Date(2026, 10, 9, 10, 30);

async function emptyDb(): Promise<SqlDriver> {
  return openBetterSqliteDriver(':memory:');
}

async function seededDb(): Promise<SqlDriver> {
  const db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  await insertDemoData(db, buildDemoData({ today: NOW, newId: randomUUID }));
  return db;
}

describe('Today', () => {
  it('shows the loading skeleton while the database opens', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />);
    expect(screen.getByTestId('state-loading')).toBeTruthy();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('shows the empty state on a fresh database and opens quick add', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: emptyDb });
    expect(await screen.findByTestId('state-empty')).toBeTruthy();
    expect(screen.getByText('Nothing planned yet')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Add a task' })[0]!);
    expect(mockPush).toHaveBeenCalledWith('/task/new');
  });

  it('lists today’s synthetic tasks and the workload', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: seededDb });
    expect(await screen.findByTestId('state-success')).toBeTruthy();
    expect(screen.getByText('Draft the project outline')).toBeTruthy();
    expect(screen.getByText('3h 55m of 6h planned')).toBeTruthy();
  });

  it('shows the error state when the database cannot open, and retries', async () => {
    const open = jest.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(emptyDb);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderWithProviders(<TodayScreen now={NOW} />, { open });
    expect(await screen.findByTestId('state-error')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('state-empty')).toBeTruthy();
    expect(open).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('uses charcoal with orange for the round action on the day header', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: emptyDb, theme: { scheme: 'dark', period: 'day' } });
    await screen.findByTestId('state-empty');
    const bell = screen.getByRole('button', { name: 'Reminders' });
    expect(bell).toHaveStyle({ backgroundColor: charcoal });
  });

  it('uses orange for the round action at night', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: emptyDb, theme: { scheme: 'dark', period: 'night' } });
    await screen.findByTestId('state-empty');
    expect(screen.getByRole('button', { name: 'Reminders' })).toHaveStyle({ backgroundColor: orange });
  });

  it('renders in French', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: emptyDb, language: 'fr' });
    expect(await screen.findByText('Rien de prévu pour l’instant')).toBeTruthy();
    expect(screen.getByText('lundi')).toBeTruthy();
    expect(screen.getByText('0 min sur 8 h planifiées')).toBeTruthy();
  });
});

describe('Goals and Routines', () => {
  it.each([
    ['Goals', GoalsScreen, 'No goals yet', 'Run a 10 km race'],
    ['Routines', RoutinesScreen, 'No routines yet', 'Morning start'],
  ] as const)('%s shows empty then success states', async (_name, Screen, emptyText, itemText) => {
    const first = await renderWithProviders(<Screen />, { open: emptyDb });
    expect(await screen.findByText(emptyText)).toBeTruthy();
    await first.unmount();
    await renderWithProviders(<Screen />, { open: seededDb });
    expect(await screen.findByText(itemText)).toBeTruthy();
  });
});

describe('Me', () => {
  it('changes theme and language preferences', async () => {
    await renderWithProviders(<MeScreen />, { open: emptyDb });
    await fireEvent.press(screen.getByRole('radio', { name: 'Light' }));
    expect(usePreferences.getState().theme).toBe('light');
    await fireEvent.press(screen.getByRole('radio', { name: 'Français' }));
    expect(usePreferences.getState().language).toBe('fr');
    expect(screen.getByText('VIZAM portfolio concept')).toBeTruthy();
  });
});

describe('Calendar (risk check 2: react-native-calendars Timeline on RN 0.88)', () => {
  it('renders the Timeline with synthetic events and switches to the month grid', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} />, { open: seededDb });
    expect(await screen.findByTestId('calendar-timeline')).toBeTruthy();
    expect(await screen.findByText('Draft the project outline')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Day' })).toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: 'Month' }));
    expect(screen.getByRole('tab', { name: 'Month' })).toBeSelected();
    expect((await screen.findAllByText('15')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('calendar-timeline')).toBeNull();
  });

  it('shows an empty note above the timeline on a clear day', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} />, { open: emptyDb, language: 'fr' });
    expect(await screen.findByText('Une journée libre')).toBeTruthy();
    expect(screen.getByTestId('calendar-timeline')).toBeTruthy();
  });
});
