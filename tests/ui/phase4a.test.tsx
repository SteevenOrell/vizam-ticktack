import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { randomUUID } from 'crypto';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { buildDemoData, insertDemoData } from '../../src/data/seed/demoData';
import { createTask, emptyDraft, setDone, type TaskDraft } from '../../src/data/tasks';
import { addDays } from '../../src/domain/localDate';
import { occurrenceId } from '../../src/domain/recurrence/generator';
import { CalendarScreen } from '../../src/features/calendar/CalendarScreen';
import { HistoryScreen } from '../../src/features/tasks/HistoryScreen';
import { OverdueScreen } from '../../src/features/tasks/OverdueScreen';
import { flushDeletes, usePendingDeletes } from '../../src/features/tasks/pendingDeletes';
import { TaskDetailScreen } from '../../src/features/tasks/TaskDetailScreen';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { contentWidth, WIDE_BREAKPOINT } from '../../src/ui/theme/layout';
import { context } from '../support/db';
import { renderWithProviders } from '../support/render';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const NOW = new Date(2026, 10, 9, 10, 30); // Monday
const TODAY = '2026-11-09';
let db: SqlDriver;

async function fresh(): Promise<SqlDriver> {
  db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  return db;
}
async function seeded(language = 'en'): Promise<SqlDriver> {
  await fresh();
  await insertDemoData(db, buildDemoData({ today: NOW, newId: randomUUID, language }));
  return db;
}
const ctx = () => context(db, 'local', () => NOW);
const draft = (patch: Partial<TaskDraft> = {}): TaskDraft => ({ ...emptyDraft(TODAY), title: 'Task', ...patch });
const daily = {
  freq: 'daily',
  interval: 1,
  byWeekday: null,
  byMonthDay: null,
  weekStartsOn: 1,
  endType: 'never',
  endDate: null,
  count: null,
} as const;
const idOf = async (title: string) =>
  (await db.first<{ id: string }>('SELECT id FROM tasks WHERE title = ? AND deleted = 0', [title]))?.id as string;
const startOf = async (id: string) =>
  (await db.first<{ start_time: string | null }>('SELECT start_time FROM tasks WHERE id = ?', [id]))?.start_time;

beforeEach(() => {
  jest.clearAllMocks();
  useSession.setState({ status: 'starting', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
});
afterEach(async () => {
  await flushDeletes();
  usePendingDeletes.setState({ pending: [] });
});

describe('Task details', () => {
  it('opens from a Today row', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: () => seeded() });
    await fireEvent.press(await screen.findByRole('button', { name: /^Draft the project outline,/ }));
    const id = await idOf('Draft the project outline');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/task/details/[id]', params: { id } });
    expect(screen.getByRole('button', { name: /^Draft the project outline,/ }).props.accessibilityHint).toBe(
      'Opens the task details',
    );
  });

  it('shows time, date, notes, subtasks and the reminder, and opens the editor', async () => {
    await seeded();
    const id = await idOf('Draft the project outline');
    await renderWithProviders(<TaskDetailScreen taskId={id} now={NOW} />, { open: async () => db });
    const detail = await screen.findByTestId('task-detail');
    expect(within(detail).getByRole('header', { name: 'Draft the project outline' })).toBeTruthy();
    expect(screen.getByTestId('detail-time')).toHaveTextContent('9:30 AM');
    expect(screen.getByTestId('detail-date')).toHaveTextContent('Mon, Nov 9 · 1h 30m');
    expect(screen.getByTestId('detail-notes')).toBeTruthy();
    expect(within(detail).getByText(/Subtasks · 1\/3/)).toBeTruthy();
    expect(screen.getByTestId('detail-reminders')).toHaveTextContent('10 minutes before');
    expect(screen.queryByTestId('detail-repeat')).toBeNull();

    await fireEvent.press(screen.getByTestId('detail-edit'));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/task/[id]', params: { id } });
  });

  it('completes the task, ticks a subtask and reopens it', async () => {
    await seeded();
    const id = await idOf('Draft the project outline');
    await renderWithProviders(<TaskDetailScreen taskId={id} now={NOW} />, { open: async () => db });
    await fireEvent.press(await screen.findByTestId('detail-toggle'));
    await waitFor(async () =>
      expect((await db.first<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [id]))?.status).toBe('done'),
    );
    expect(await screen.findByRole('button', { name: 'Mark not done' })).toBeTruthy();

    const open = (await screen.findAllByRole('checkbox', { checked: false }))[0]!;
    await fireEvent.press(open);
    expect(await screen.findByText(/Subtasks · 2\/3/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('detail-toggle'));
    await waitFor(async () =>
      expect((await db.first<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [id]))?.status).toBe('open'),
    );
  });

  it('deletes with Undo: the screen closes, the delete waits, Undo keeps the task', async () => {
    await fresh();
    const t = await createTask(ctx(), draft({ title: 'Call the bank', startTime: '11:00' }));
    await renderWithProviders(<TaskDetailScreen taskId={t.id} now={NOW} />, { open: async () => db });
    await fireEvent.press(await screen.findByTestId('detail-delete'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('undo-snackbar')).toHaveTextContent(/“Call the bank” deleted/);
    expect((await db.first<{ deleted: number }>('SELECT deleted FROM tasks WHERE id = ?', [t.id]))?.deleted).toBe(0);
    await fireEvent.press(screen.getByTestId('undo-delete'));
    await act(async () => {
      await flushDeletes();
    });
    expect((await db.first<{ deleted: number }>('SELECT deleted FROM tasks WHERE id = ?', [t.id]))?.deleted).toBe(0);
  });

  it('shows the repeat summary of an occurrence, asks the scope on delete and reaches quick edit', async () => {
    await fresh();
    const s = await createTask(
      ctx(),
      draft({
        title: 'Gym',
        startTime: '18:00',
        repeat: { ...daily, freq: 'weekly', interval: 2, byWeekday: [1, 4], endType: 'onDate', endDate: '2026-12-20' },
      }),
    );
    const occ = occurrenceId(s.id, TODAY);
    await renderWithProviders(<TaskDetailScreen taskId={s.id} occurrenceId={occ} now={NOW} />, {
      open: async () => db,
    });
    expect(await screen.findByTestId('detail-repeat')).toHaveTextContent(
      'Every 2 weeks on Mon, Thu · until Sun, Dec 20',
    );
    await fireEvent.press(screen.getByTestId('detail-reschedule'));
    expect(await screen.findByTestId('quick-title')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));

    await fireEvent.press(screen.getByTestId('detail-delete'));
    await fireEvent.press(await screen.findByTestId('delete-scope-this'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    await act(async () => {
      await flushDeletes();
    });
    const row = await db.first<{ status: string }>('SELECT status FROM task_occurrences WHERE id = ?', [occ]);
    expect(row?.status).toBe('skipped');
    expect((await db.first<{ deleted: number }>('SELECT deleted FROM tasks WHERE id = ?', [s.id]))?.deleted).toBe(0);
  });

  it('says so in French when the task does not exist', async () => {
    await renderWithProviders(<TaskDetailScreen taskId="missing" now={NOW} />, { open: fresh, language: 'fr' });
    expect(await screen.findByText('Cette tâche n’existe plus.')).toBeTruthy();
    expect(screen.getByTestId('screen-task-detail-back').props.accessibilityLabel).toBe('Retour');
    await fireEvent.press(screen.getByTestId('screen-task-detail-back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('Reschedule from the calendar', () => {
  it('moves a one-off task with the "move later" action (the non-drag way)', async () => {
    await fresh();
    const t = await createTask(ctx(), draft({ title: 'Call the bank', startTime: '11:00', durationMin: 30 }));
    await renderWithProviders(<CalendarScreen now={NOW} initialView="day" />, { open: async () => db });
    const block = await screen.findByTestId(`block-${t.id}`);
    expect(block.props.accessibilityHint).toMatch(/Long press, then drag/);
    expect(block.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      'earlier',
      'later',
      'quickEdit',
    ]);
    await fireEvent(block, 'accessibilityAction', { nativeEvent: { actionName: 'later' } });
    await waitFor(async () => expect(await startOf(t.id)).toBe('11:15'));
    expect(await screen.findByRole('button', { name: /^Call the bank, 11:15 AM – 11:45 AM/ })).toBeTruthy();

    await fireEvent(screen.getByTestId(`block-${t.id}`), 'accessibilityAction', {
      nativeEvent: { actionName: 'quickEdit' },
    });
    expect(await screen.findByTestId('quick-title')).toBeTruthy();
  });

  it('a long press without a move opens the row menu (quick edit stays reachable)', async () => {
    await fresh();
    const t = await createTask(ctx(), draft({ title: 'Call the bank', startTime: '11:00' }));
    await renderWithProviders(<CalendarScreen now={NOW} initialView="day" />, { open: async () => db });
    const block = await screen.findByTestId(`block-${t.id}`);
    await fireEvent(block, 'longPress');
    expect(screen.getByTestId('drag-time')).toHaveTextContent('11:00 AM');
    await fireEvent(screen.getByTestId(`block-${t.id}`), 'pressOut');
    expect(await screen.findByTestId('menu-quick-edit')).toBeTruthy();
    expect(screen.queryByTestId('drag-time')).toBeNull();
    expect(await startOf(t.id)).toBe('11:00');
  });

  it('asks this / following / all for a repeating task and moves only this one', async () => {
    await fresh();
    const s = await createTask(ctx(), draft({ title: 'Gym', startTime: '18:00', repeat: daily }));
    const occ = occurrenceId(s.id, TODAY);
    await renderWithProviders(<CalendarScreen now={NOW} initialView="day" />, { open: async () => db });
    await fireEvent(await screen.findByTestId(`block-${occ}`), 'accessibilityAction', {
      nativeEvent: { actionName: 'earlier' },
    });
    expect(await screen.findByText('Move this repeating task')).toBeTruthy();
    expect(screen.getByTestId('move-scope-following')).toBeTruthy();
    expect(screen.getByTestId('move-scope-all')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('move-scope-this'));
    await waitFor(async () =>
      expect(
        (await db.first<{ start_time: string }>('SELECT start_time FROM task_occurrences WHERE id = ?', [occ]))
          ?.start_time,
      ).toBe('17:45'),
    );
    expect(await startOf(s.id)).toBe('18:00');
  });

  it('shows why a goal-linked repeat cannot be moved for all days', async () => {
    await fresh();
    const s = await createTask(ctx(), draft({ title: 'Gym', startTime: '18:00', repeat: daily }));
    // Older data: an endless series linked to a goal without the check.
    const other = await createTask(ctx(), draft({ title: 'Buy shoes', newGoalTitle: 'Fit' }));
    const goalId = (await db.first<{ goal_id: string }>('SELECT goal_id FROM tasks WHERE id = ?', [other.id]))?.goal_id;
    await db.run('UPDATE tasks SET goal_id = ? WHERE id = ?', [goalId as string, s.id]);
    const occ = occurrenceId(s.id, TODAY);
    await renderWithProviders(<CalendarScreen now={NOW} initialView="day" />, { open: async () => db });
    await fireEvent(await screen.findByTestId(`block-${occ}`), 'accessibilityAction', {
      nativeEvent: { actionName: 'later' },
    });
    await fireEvent.press(await screen.findByTestId('move-scope-all'));
    expect(await screen.findByTestId('calendar-notice')).toHaveTextContent(
      'A task linked to a goal can’t repeat forever. Choose when it ends.',
    );
    expect(await startOf(s.id)).toBe('18:00');
  });
});

describe('Week hour grid (tablet and desktop)', () => {
  it('keeps the stacked week on phones', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} initialView="week" />, { open: () => seeded() });
    expect(await screen.findByTestId('week-day-2026-11-09')).toBeTruthy();
    expect(screen.queryByTestId('week-grid')).toBeNull();
  });

  it('shows seven day columns on one hour grid when wide', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} initialView="week" wide />, { open: () => seeded() });
    const grid = await screen.findByTestId('week-grid');
    const lanes = within(grid).getAllByTestId(/^timeline-lane-/);
    expect(lanes).toHaveLength(7);
    expect(lanes[0]?.props.testID).toBe('timeline-lane-2026-11-08'); // week starts on Sunday in English
    expect(within(screen.getByTestId('timeline-lane-2026-11-09')).getByText('Draft the project outline')).toBeTruthy();
    expect(within(screen.getByTestId('timeline-lane-2026-11-09')).getByTestId('timeline-now')).toBeTruthy();
    expect(within(screen.getByTestId('week-all-day')).getByText('Water the plants')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Mon 9, Today,/ })).toBeTruthy();

    await fireEvent.press(screen.getByTestId('week-col-2026-11-11'));
    expect(screen.getByTestId('week-col-2026-11-11').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('uses 768 as the breakpoint and a wider column for the grid', () => {
    expect(WIDE_BREAKPOINT).toBe(768);
    expect(contentWidth).toEqual({ text: 720, grid: 1120 });
  });
});

describe('Overdue view', () => {
  it('is reached from the Today header and lists open tasks from before today', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: () => seeded() });
    await fireEvent.press(await screen.findByRole('button', { name: 'Overdue · 1' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/overdue');
    await fireEvent.press(screen.getByRole('button', { name: 'History' }));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/history');
  });

  it('moves a task to today, completes another and ends on the empty state', async () => {
    await fresh();
    const a = await createTask(ctx(), draft({ title: 'Pay the invoice', date: addDays(TODAY, -3) }));
    const b = await createTask(ctx(), draft({ title: 'Send the form', date: addDays(TODAY, -1) }));
    await renderWithProviders(<OverdueScreen now={NOW} />, { open: async () => db });
    expect(await screen.findByTestId('overdue-count')).toHaveTextContent('2 tasks from before today are still open.');
    expect(screen.getByRole('header', { name: 'Overdue' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Move “Pay the invoice” to today' }));
    await waitFor(() => expect(screen.queryByTestId(`overdue-${a.id}`)).toBeNull());
    expect((await db.first<{ date: string }>('SELECT date FROM tasks WHERE id = ?', [a.id]))?.date).toBe(TODAY);

    await fireEvent.press(screen.getByTestId(`overdue-done-${b.id}`));
    expect(await screen.findByText('Nothing overdue')).toBeTruthy();
    expect((await db.first<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [b.id]))?.status).toBe('done');
  });

  it('moves everything to today at once (French)', async () => {
    await fresh();
    await createTask(ctx(), draft({ title: 'Un', date: addDays(TODAY, -3) }));
    await createTask(ctx(), draft({ title: 'Deux', date: addDays(TODAY, -2) }));
    await renderWithProviders(<OverdueScreen now={NOW} />, { open: async () => db, language: 'fr' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Tout reporter à aujourd’hui' }));
    expect(await screen.findByText('Rien en retard')).toBeTruthy();
    const left = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE date < ?', [TODAY]);
    expect(left?.n).toBe(0);
  });
});

describe('History view', () => {
  it('groups completed tasks by day, counts the week, filters missed ones and restores a task', async () => {
    await fresh();
    const today1 = await createTask(ctx(), draft({ title: 'Write notes', startTime: '09:00' }));
    await setDone(ctx(), { taskId: today1.id }, true);
    const sat = await createTask(ctx(), draft({ title: 'Clean desk', date: '2026-11-07' }));
    await setDone(
      context(db, 'local', () => new Date(2026, 10, 7, 15, 0)),
      { taskId: sat.id },
      true,
    );
    await createTask(ctx(), draft({ title: 'Stretch', date: '2026-11-07', startTime: '07:00', repeat: daily }));

    await renderWithProviders(<HistoryScreen now={NOW} />, { open: async () => db });
    const todayGroup = await screen.findByTestId('history-day-2026-11-09');
    expect(within(todayGroup).getByText('Today · 1')).toBeTruthy();
    expect(within(todayGroup).getByText('Write notes')).toBeTruthy();
    const saturday = screen.getByTestId('history-day-2026-11-07');
    expect(within(saturday).getByText('Sat, Nov 7 · 2')).toBeTruthy();
    expect(within(saturday).getByText('Missed')).toBeTruthy();
    // English week starts on Sunday Nov 8: only today's task counts.
    expect(screen.getByTestId('history-week')).toHaveTextContent('1task done this week');

    await fireEvent.press(screen.getByTestId('history-filter-missed'));
    expect(screen.queryByText('Write notes')).toBeNull();
    expect(screen.getAllByText('Stretch')).toHaveLength(2); // Saturday and Sunday
    await fireEvent.press(screen.getByTestId('history-filter-done'));
    expect(screen.queryByText('Stretch')).toBeNull();
    expect(screen.getByText('Clean desk')).toBeTruthy();

    // Unticking restores the task: it leaves the history.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Mark “Write notes” not done' }));
    await waitFor(() => expect(screen.queryByText('Write notes')).toBeNull());
    expect((await db.first<{ status: string }>('SELECT status FROM tasks WHERE id = ?', [today1.id]))?.status).toBe(
      'open',
    );
  });

  it('has an empty state', async () => {
    await renderWithProviders(<HistoryScreen now={NOW} />, { open: fresh, language: 'fr' });
    expect(await screen.findByText('Pas encore d’historique')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Historique' })).toBeTruthy();
  });
});
