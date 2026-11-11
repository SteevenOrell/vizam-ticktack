import { screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'crypto';
import type { ReactElement } from 'react';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { buildDemoData, insertDemoData } from '../../src/data/seed/demoData';
import { CalendarScreen } from '../../src/features/calendar/CalendarScreen';
import { GoalsScreen } from '../../src/features/goals/GoalsScreen';
import { RoutinesScreen } from '../../src/features/routines/RoutinesScreen';
import { CategoriesScreen } from '../../src/features/settings/CategoriesScreen';
import { MeScreen } from '../../src/features/settings/MeScreen';
import { HistoryScreen } from '../../src/features/tasks/HistoryScreen';
import { OverdueScreen } from '../../src/features/tasks/OverdueScreen';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { sizes } from '../../src/ui/theme/layout';
import { renderWithProviders } from '../support/render';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

const NOW = new Date(2026, 10, 9, 10, 30);

async function seeded(): Promise<SqlDriver> {
  const db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  await insertDemoData(db, buildDemoData({ today: NOW, newId: randomUUID }));
  return db;
}

beforeEach(() => {
  useSession.setState({ status: 'guest', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
});

const textOf = (node: ReactTestRendererJSON | string): string =>
  typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(' ');

/** Every pressable (a host node with an onClick) needs a role and a name a screen reader can announce. */
function unlabelledControls(root: ReactTestRendererJSON | ReactTestRendererJSON[] | null): string[] {
  const problems: string[] = [];
  const visit = (node: ReactTestRendererJSON | string) => {
    if (typeof node === 'string') return;
    const p = node.props as Record<string, unknown>;
    if (typeof p.onClick === 'function' || (typeof p.onPress === 'function' && p.accessible !== false)) {
      const role = p.accessibilityRole ?? p.role;
      const name = (p.accessibilityLabel ?? p['aria-label'] ?? textOf(node)) as string;
      if (!role) problems.push(`no role: ${String(p.testID ?? name).slice(0, 60)}`);
      if (!String(name).trim()) problems.push(`no name: ${String(p.testID ?? role)}`);
    }
    (node.children ?? []).forEach(visit);
  };
  (Array.isArray(root) ? root : root ? [root] : []).forEach(visit);
  return problems;
}

const screens: { name: string; element: ReactElement; ready: string | RegExp }[] = [
  { name: 'Today', element: <TodayScreen now={NOW} />, ready: 'Draft the project outline' },
  { name: 'Calendar', element: <CalendarScreen now={NOW} />, ready: 'Draft the project outline' },
  { name: 'Goals', element: <GoalsScreen now={NOW} />, ready: /./ },
  { name: 'Routines', element: <RoutinesScreen now={NOW} />, ready: /./ },
  { name: 'Overdue', element: <OverdueScreen now={NOW} />, ready: /./ },
  { name: 'History', element: <HistoryScreen now={NOW} />, ready: /./ },
  { name: 'Me', element: <MeScreen />, ready: 'Planning' },
  { name: 'Categories', element: <CategoriesScreen />, ready: 'Categories' },
];

describe('accessibility: controls are named', () => {
  it.each(screens)('$name: every pressable has a role and a name', async ({ element, ready }) => {
    await renderWithProviders(element, { open: seeded });
    await waitFor(() => expect(screen.queryByTestId('state-loading')).toBeNull());
    if (typeof ready === 'string') await screen.findAllByText(ready);
    expect(unlabelledControls(screen.toJSON())).toEqual([]);
  });
});

describe('accessibility: touch targets', () => {
  it('keeps every button style at 44 px or more', () => {
    expect(sizes.touch).toBeGreaterThanOrEqual(44);
    expect(sizes.buttonCompact).toBeGreaterThanOrEqual(44);
    expect(sizes.buttonLarge).toBeGreaterThanOrEqual(44);
  });
});
