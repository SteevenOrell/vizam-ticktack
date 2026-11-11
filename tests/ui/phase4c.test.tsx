import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { getPlanningSettings } from '../../src/data/settings';
import { addCategory } from '../../src/data/settings';
import { createRoutine, emptyRoutineDraft, recordRoutineRun } from '../../src/data/routines';
import { createTask, emptyDraft } from '../../src/data/tasks';
import { CategoriesScreen } from '../../src/features/settings/CategoriesScreen';
import { FailedSyncScreen } from '../../src/features/settings/FailedSyncScreen';
import { MeScreen } from '../../src/features/settings/MeScreen';
import { HistoryScreen } from '../../src/features/tasks/HistoryScreen';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { context } from '../support/db';
import { renderWithProviders } from '../support/render';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const NOW = new Date(2026, 10, 9, 10, 30);
const TODAY = '2026-11-09';
let db: SqlDriver;

async function fresh(): Promise<SqlDriver> {
  db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  return db;
}
const ctx = () => context(db, 'local', () => NOW);

beforeEach(() => {
  jest.clearAllMocks();
  useSession.setState({ status: 'guest', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
});

describe('Settings: planning', () => {
  it('saves the week start and the daily capacity in the profile', async () => {
    await renderWithProviders(<MeScreen />, { open: fresh });
    // The session creates the profile once the database is open (English default: week starts Sunday).
    await waitFor(async () => expect((await getPlanningSettings(db, 'local')).weekStartsOn).toBe(0));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Monday' }));
    await waitFor(async () => expect((await getPlanningSettings(db, 'local')).weekStartsOn).toBe(1));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Monday' })).toBeSelected());
    expect(screen.getByRole('radio', { name: 'Sunday' })).not.toBeSelected();

    await fireEvent.press(screen.getByRole('button', { name: 'Increase daily capacity by 30 minutes' }));
    await waitFor(async () => expect((await getPlanningSettings(db, 'local')).dailyCapacityMin).toBe(510));
    expect(await screen.findByLabelText('Daily capacity: 8h 30m')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease daily capacity by 30 minutes' }));
    await waitFor(async () => expect((await getPlanningSettings(db, 'local')).dailyCapacityMin).toBe(480));
  });

  it('opens the categories manager and shows no failed-sync link without failures', async () => {
    await renderWithProviders(<MeScreen />, { open: fresh });
    await fireEvent.press(await screen.findByRole('button', { name: 'Categories' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/categories');
    expect(screen.queryByTestId('open-failed-sync')).toBeNull();
  });

  it('shows the reminders note (not available on the web test platform)', async () => {
    await renderWithProviders(<MeScreen />, { open: fresh });
    expect(await screen.findByTestId('settings-reminders-status')).toBeTruthy();
  });
});

describe('Settings: categories', () => {
  it('adds a category, rejects a duplicate and deletes with a new home for its items', async () => {
    await fresh();
    const a = await addCategory(ctx(), 'Home');
    await addCategory(ctx(), 'Health');
    const task = await createTask(ctx(), { ...emptyDraft(TODAY), title: 'Water plants', categoryName: 'Home' });
    await renderWithProviders(<CategoriesScreen />, { open: async () => db });
    expect(await screen.findByLabelText('Home, 1 item')).toBeTruthy();
    expect(screen.getByLabelText('Health, Not used yet')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('category-add'));
    await fireEvent.changeText(await screen.findByTestId('category-name'), 'health');
    await fireEvent.press(screen.getByTestId('category-save'));
    expect(await screen.findByText('You already have a category with this name.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('category-name'), 'Study');
    await fireEvent.press(screen.getByTestId('category-save'));
    expect(await screen.findByLabelText('Study, Not used yet')).toBeTruthy();

    // Delete "Home" (one task) and move the task to "Study".
    await fireEvent.press(screen.getByLabelText('Home, 1 item'));
    await fireEvent.press(await screen.findByTestId('category-delete'));
    expect(await screen.findByText('1 item uses this category. Where should it go?')).toBeTruthy();
    const study = await db.first<{ id: string }>("SELECT id FROM categories WHERE name = 'Study'");
    await fireEvent.press(screen.getByTestId(`category-move-${study?.id}`));
    await waitFor(async () =>
      expect(
        (await db.first<{ category_id: string }>('SELECT category_id FROM tasks WHERE id = ?', [task.id]))?.category_id,
      ).toBe(study?.id),
    );
    await waitFor(() => expect(screen.queryByLabelText('Home, 1 item')).toBeNull());
    expect(a.id).toBeTruthy();
    expect(await screen.findByLabelText('Study, 1 item')).toBeTruthy();
  });

  it('shows an empty state with an add action', async () => {
    await renderWithProviders(<CategoriesScreen />, { open: fresh });
    expect(await screen.findByText('No categories')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add category' }).length).toBeGreaterThan(0);
  });
});

describe('Settings: failed sync list', () => {
  async function failed(title: string) {
    const task = await createTask(ctx(), { ...emptyDraft(TODAY), title });
    await db.run(
      `UPDATE outbox SET state = 'failed', attempts = 2, last_error = 'permission-denied' WHERE entity_id = ?`,
      [task.id],
    );
    return task;
  }

  it('lists the entity and the error, retries one and discards another after a confirm', async () => {
    await fresh();
    const one = await failed('Buy milk');
    const two = await failed('Call the dentist office');
    await renderWithProviders(<FailedSyncScreen />, { open: async () => db });
    expect(await screen.findByText('Buy milk')).toBeTruthy();
    expect(screen.getAllByText('Not allowed by your account rules.')).toHaveLength(2);
    expect(screen.getAllByText('Task').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId(`failed-retry-${one.id}`));
    await waitFor(() => expect(screen.queryByText('Buy milk')).toBeNull());
    expect((await db.first<{ state: string }>('SELECT state FROM outbox WHERE entity_id = ?', [one.id]))?.state).toBe(
      'pending',
    );

    await fireEvent.press(screen.getByTestId(`failed-discard-${two.id}`));
    expect(await screen.findByText('Discard this change?')).toBeTruthy();
    // Cancelling keeps it.
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(await db.first('SELECT 1 AS x FROM outbox WHERE entity_id = ?', [two.id])).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`failed-discard-${two.id}`));
    await fireEvent.press(await screen.findByTestId('failed-discard-confirm'));
    await waitFor(async () =>
      expect(await db.first('SELECT 1 AS x FROM outbox WHERE entity_id = ?', [two.id])).toBeNull(),
    );
    expect(await screen.findByText('Nothing failed')).toBeTruthy();
  });
});

describe('History with routine runs', () => {
  it('lists a completed routine run next to completed tasks', async () => {
    await fresh();
    const r = await createRoutine(ctx(), {
      ...emptyRoutineDraft(1),
      title: 'Morning routine',
      steps: [{ title: 'Stretch', durationMin: 5 }],
    });
    await recordRoutineRun(ctx(), r.id, TODAY, { completedStepIds: [r.steps[0]?.id ?? ''] });
    await renderWithProviders(<HistoryScreen now={NOW} />, { open: async () => db });
    expect(await screen.findByText('Morning routine')).toBeTruthy();
    expect(screen.queryByTestId('state-empty')).toBeNull();
    await act(async () => undefined);
  });
});
