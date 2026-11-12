import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { randomUUID } from 'crypto';
import { View } from 'react-native';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { buildDemoData, insertDemoData } from '../../src/data/seed/demoData';
import { CalendarScreen } from '../../src/features/calendar/CalendarScreen';
import {
  flushDeletes,
  isHidden,
  scheduleDelete,
  undoDelete,
  UNDO_MS,
  usePendingDeletes,
} from '../../src/features/tasks/pendingDeletes';
import { TaskEditorScreen } from '../../src/features/tasks/TaskEditorScreen';
import { UndoSnackbar } from '../../src/features/tasks/UndoSnackbar';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { renderWithProviders } from '../support/render';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const NOW = new Date(2026, 10, 9, 10, 30); // Monday
let db: SqlDriver;

async function seeded(language = 'en'): Promise<SqlDriver> {
  db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  await insertDemoData(db, buildDemoData({ today: NOW, newId: randomUUID, language }));
  return db;
}
async function fresh(): Promise<SqlDriver> {
  db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  return db;
}

function Today() {
  return (
    <View style={{ flex: 1 }}>
      <TodayScreen now={NOW} />
      <UndoSnackbar bottom={100} />
    </View>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  useSession.setState({ status: 'starting', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
  await flushDeletes();
  usePendingDeletes.setState({ pending: [] });
});

describe('pending deletes (undo)', () => {
  afterEach(() => jest.useRealTimers());

  it('runs the delete after the undo window, or never when undone', async () => {
    jest.useFakeTimers();
    const run = jest.fn(async () => undefined);
    scheduleDelete({ label: 'A', hide: { key: 'a' }, run });
    expect(usePendingDeletes.getState().pending).toHaveLength(1);
    jest.advanceTimersByTime(UNDO_MS - 1);
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);

    const undone = jest.fn(async () => undefined);
    const id = scheduleDelete({ label: 'B', hide: { key: 'b' }, run: undone });
    undoDelete(id);
    jest.advanceTimersByTime(UNDO_MS * 2);
    expect(undone).not.toHaveBeenCalled();
    expect(usePendingDeletes.getState().pending.find((p) => p.id === id)).toBeUndefined();
  });

  it('a newer delete commits the previous one at once', async () => {
    const first = jest.fn(async () => undefined);
    scheduleDelete({ label: 'A', hide: { key: 'a' }, run: first });
    scheduleDelete({ label: 'B', hide: { key: 'b' }, run: jest.fn(async () => undefined) });
    await waitFor(() => expect(first).toHaveBeenCalled());
  });

  it('hides one row, a series, or a series from a date on', () => {
    const item = { key: 'occ_20261112', taskId: 'occ', date: '2026-11-12' };
    expect(isHidden(item, [{ id: '1', label: '', hide: { key: 'occ_20261112' } }])).toBe(true);
    expect(isHidden(item, [{ id: '1', label: '', hide: { taskId: 'occ' } }])).toBe(true);
    expect(isHidden(item, [{ id: '1', label: '', hide: { taskId: 'occ', fromDate: '2026-11-13' } }])).toBe(false);
    expect(isHidden(item, [{ id: '1', label: '', hide: { taskId: 'occ', fromDate: '2026-11-12' } }])).toBe(true);
  });
});

describe('Today rows', () => {
  it('shows the start time column, the duration and "Anytime"', async () => {
    await renderWithProviders(<Today />, { open: () => seeded() });
    const scheduled = await screen.findByTestId('group-scheduled');
    const review = within(scheduled).getByRole('button', { name: /^Review the weekly plan,/ });
    expect(review.props.accessibilityLabel).toContain('8:30 AM');
    expect(within(scheduled).getAllByText(/^8:30/).length).toBeGreaterThan(0);
    expect(within(scheduled).getAllByText('1h 30m').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('group-anytime')).getAllByText('Anytime').length).toBeGreaterThan(0);
  });

  it('previews two subtasks, "+1 more" and the note, and expands in place to tick a subtask', async () => {
    await renderWithProviders(<Today />, { open: () => seeded() });
    const preview = await screen.findByRole('button', {
      name: 'Show subtasks and notes of “Draft the project outline”',
    });
    expect(within(preview).getByText('List the main sections')).toBeTruthy();
    expect(within(preview).getByText('Write the summary')).toBeTruthy();
    expect(within(preview).queryByText('Add the timeline')).toBeNull();
    expect(within(preview).getByText('+1 more')).toBeTruthy();
    expect(within(preview).getByText(/Keep it to two pages/)).toBeTruthy();

    await fireEvent.press(preview);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Mark “Add the timeline” done' }));
    await waitFor(async () =>
      expect(await db.first("SELECT status FROM tasks WHERE title = 'Add the timeline'")).toEqual({ status: 'done' }),
    );
    expect(mockRouter.push).not.toHaveBeenCalled(); // no navigation
    expect(await screen.findByText(/2\/3 subtasks/)).toBeTruthy();
  });

  it('shows the linked goal on the row', async () => {
    await renderWithProviders(<Today />, { open: () => seeded() });
    const walk = await screen.findByRole('button', { name: /^Lunch walk,/ });
    expect(walk.props.accessibilityLabel).toContain('Goal: Run a 10 km race');
  });

  it('deletes from the "⋯" menu, hides the row and brings it back with Undo', async () => {
    await renderWithProviders(<Today />, { open: () => seeded() });
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions for “Water the plants”' }));
    await fireEvent.press(await screen.findByTestId('menu-delete'));
    await waitFor(() => expect(screen.queryByText('Water the plants')).toBeNull());
    expect(await screen.findByTestId('undo-snackbar')).toHaveTextContent(/“Water the plants” deleted/);
    await fireEvent.press(screen.getByTestId('undo-delete'));
    expect(await screen.findByText('Water the plants')).toBeTruthy();
    expect(await db.first("SELECT deleted FROM tasks WHERE title = 'Water the plants'")).toEqual({ deleted: 0 });

    // Delete again and let it run: tombstoned and queued for sync.
    await fireEvent.press(screen.getByRole('button', { name: 'More actions for “Water the plants”' }));
    await fireEvent.press(await screen.findByTestId('menu-delete'));
    await waitFor(() => expect(screen.queryByText('Water the plants')).toBeNull());
    await act(async () => {
      await flushDeletes();
    });
    expect(await db.first("SELECT deleted FROM tasks WHERE title = 'Water the plants'")).toEqual({ deleted: 1 });
  });

  it('asks this / following / all for a recurring occurrence and deletes only this one', async () => {
    await renderWithProviders(<Today />, { open: () => seeded() });
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions for “Stretch break”' }));
    await fireEvent.press(await screen.findByTestId('menu-delete'));
    expect(await screen.findByTestId('delete-scope-following')).toBeTruthy();
    expect(screen.getByTestId('delete-scope-all')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delete-scope-this'));
    await waitFor(() => expect(screen.queryByText('Stretch break')).toBeNull());
    await act(async () => {
      await flushDeletes();
    });
    const rows = await db.all<{ original_date: string; status: string }>(
      "SELECT original_date, status FROM task_occurrences WHERE is_exception = 1 AND status = 'skipped'",
    );
    expect(rows).toEqual([{ original_date: '2026-11-09', status: 'skipped' }]);
    const nextDay = await db.first<{ status: string }>(
      "SELECT status FROM task_occurrences WHERE original_date = '2026-11-10' AND series_id IN (SELECT id FROM tasks WHERE title = 'Stretch break')",
    );
    expect(nextDay?.status).toBe('scheduled');
  });

  it('quick edits title, duration and category through the normal write path', async () => {
    await renderWithProviders(<Today />, { open: () => seeded() });
    await fireEvent.press(await screen.findByRole('button', { name: 'More actions for “Lunch walk”' }));
    await fireEvent.press(await screen.findByTestId('menu-quick-edit'));
    await fireEvent.changeText(await screen.findByTestId('quick-title'), 'Long lunch walk');
    await fireEvent.press(screen.getByTestId('quick-duration'));
    await fireEvent.press(screen.getByTestId('quick-duration-option-75'));
    await fireEvent.changeText(screen.getByTestId('quick-category'), 'outdoors');
    await fireEvent.press(screen.getByTestId('quick-edit-save'));
    await waitFor(() => expect(screen.queryByTestId('quick-edit')).toBeNull());
    await waitFor(async () =>
      expect(
        await db.first(
          "SELECT t.duration_min, c.name FROM tasks t JOIN categories c ON c.id = t.category_id WHERE t.title = 'Long lunch walk'",
        ),
      ).toEqual({ duration_min: 75, name: 'outdoors' }),
    );
    expect(await db.first("SELECT count(*) AS n FROM outbox WHERE entity_type = 'categories'")).toEqual({ n: 1 });
  });
});

describe('Task editor dropdowns, categories and goals', () => {
  it('offers durations up to 12 h and saves the one picked', async () => {
    await renderWithProviders(<TaskEditorScreen now={NOW} />, { open: fresh });
    await fireEvent.changeText(screen.getByTestId('field-title'), 'Deep work');
    await fireEvent.press(screen.getByTestId('field-duration'));
    const sheet = await screen.findByTestId('field-duration-sheet');
    for (const label of ['5m', '45m', '2h 15m', '4h', '4h 30m', '8h', '9h', '12h']) {
      expect(within(sheet).getByRole('radio', { name: label })).toBeTruthy();
    }
    expect(within(sheet).queryByRole('radio', { name: '4h 15m' })).toBeNull();
    await fireEvent.press(within(sheet).getByRole('radio', { name: '2h 30m' }));
    await fireEvent.press(screen.getByTestId('field-time'));
    await fireEvent.press(await screen.findByTestId('field-time-option-14:45'));
    expect(screen.getByTestId('field-time')).toHaveTextContent('2:45 PM');
    await fireEvent.press(screen.getByTestId('save-task'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await db.first("SELECT start_time, duration_min FROM tasks WHERE title = 'Deep work'")).toEqual({
      start_time: '14:45',
      duration_min: 150,
    });
  });

  it('lists start times in 24 h in French', async () => {
    await renderWithProviders(<TaskEditorScreen now={NOW} />, { open: fresh, language: 'fr' });
    await fireEvent.press(screen.getByTestId('field-time'));
    expect(await screen.findByTestId('field-time-option-14:45')).toHaveTextContent('14:45');
    expect(screen.getByRole('radio', { name: 'Toute la journée' })).toBeTruthy();
  });

  it('suggests existing categories and reuses them case-insensitively, or creates a new one', async () => {
    await renderWithProviders(<TaskEditorScreen now={NOW} />, { open: () => seeded() });
    await fireEvent.changeText(screen.getByTestId('field-title'), 'Stretch');
    await fireEvent.changeText(screen.getByTestId('field-category'), 'hea');
    const suggestions = await screen.findByTestId('category-suggestions');
    await fireEvent.press(within(suggestions).getByRole('radio', { name: 'Health' }));
    expect(screen.getByTestId('field-category').props.value).toBe('Health');
    await fireEvent.changeText(screen.getByTestId('field-category'), 'Garden');
    expect(await screen.findByText('New category “Garden” will be created')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('field-category'), 'health');
    expect(screen.queryByTestId('category-new-hint')).toBeNull();
    await fireEvent.press(screen.getByTestId('save-task'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await db.all("SELECT name FROM categories WHERE lower(name) = 'health'")).toHaveLength(1);
  });

  it('creates a goal from the selector and links the task', async () => {
    await renderWithProviders(<TaskEditorScreen now={NOW} />, { open: fresh });
    await fireEvent.changeText(screen.getByTestId('field-title'), 'Long run');
    await fireEvent.press(screen.getByTestId('field-goal'));
    expect(await screen.findByText('No goals yet. Name one to link this task to it.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('field-new-goal'), 'Half marathon');
    await fireEvent.press(screen.getByTestId('create-goal'));
    await waitFor(() => expect(screen.getByTestId('field-goal')).toHaveTextContent(/Half marathon/));
    await fireEvent.press(screen.getByTestId('save-task'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(
      await db.first("SELECT g.title FROM tasks t JOIN goals g ON g.id = t.goal_id WHERE t.title = 'Long run'"),
    ).toEqual({ title: 'Half marathon' });
  });

  it('defaults a new repeat to "Never" (no end date)', async () => {
    await renderWithProviders(<TaskEditorScreen now={NOW} />, { open: fresh });
    await fireEvent.press(screen.getByRole('radio', { name: 'Daily' }));
    expect(screen.getByTestId('repeat-never-hint')).toHaveTextContent('Repeats with no end date.');
    expect(screen.getAllByRole('radio', { name: 'Never' }).some((n) => n.props.accessibilityState?.selected)).toBe(
      true,
    );
  });
});

describe('Calendar day timeline', () => {
  it('places timed tasks on the hour grid, side by side when they overlap, with untimed ones above', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} initialView="day" />, { open: () => seeded() });
    const grid = await screen.findByTestId('calendar-timeline');
    const block = (title: string) => within(grid).getByRole('button', { name: new RegExp(`^${title},`) });
    // Position and size sit on the block's wrapper (the drag handle); the button fills it.
    const flat = (node: ReturnType<typeof block>) =>
      Object.assign({}, ...[node.parent?.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
    const outline = flat(block('Draft the project outline'));
    const checkin = flat(block('Team check-in'));
    expect(outline.top).toBe(9.5 * 60 + 1); // 60 px per hour
    expect(outline.height).toBe(90 - 2);
    expect(outline.width).toBe('50%');
    expect(checkin.left).toBe('50%');
    expect(flat(block('Read one chapter')).width).toBe('100%');
    expect(screen.getByTestId('timeline-now')).toBeTruthy();
    expect(within(screen.getByTestId('all-day-strip')).getByText('Water the plants')).toBeTruthy();
  });

  it('shows the start time on week rows in time order', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} initialView="week" />, { open: () => seeded() });
    const monday = await screen.findByTestId('week-day-2026-11-09');
    const titles = within(monday)
      .getAllByRole('button', { name: /AM|PM|Anytime/ })
      .map((n) => String(n.props.accessibilityLabel).split(',')[0]);
    expect(titles.indexOf('Review the weekly plan')).toBeLessThan(titles.indexOf('Draft the project outline'));
    expect(within(monday).getAllByText(/^8:30/).length).toBeGreaterThan(0);
  });
});
