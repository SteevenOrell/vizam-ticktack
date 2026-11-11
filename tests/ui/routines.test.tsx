import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'crypto';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { getItemReminder } from '../../src/data/reminders';
import { createRoutine, emptyRoutineDraft, getRoutineDetail, type RoutineDraft } from '../../src/data/routines';
import { createTask, emptyDraft } from '../../src/data/tasks';
import { RoutineEditorScreen } from '../../src/features/routines/RoutineEditorScreen';
import { RoutineScreen } from '../../src/features/routines/RoutineScreen';
import { RoutinesScreen } from '../../src/features/routines/RoutinesScreen';
import { flushDeletes, undoDelete, usePendingDeletes } from '../../src/features/tasks/pendingDeletes';
import { TaskDetailScreen } from '../../src/features/tasks/TaskDetailScreen';
import { TaskEditorScreen } from '../../src/features/tasks/TaskEditorScreen';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { renderWithProviders } from '../support/render';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const NOW = new Date(2026, 10, 9, 10, 30);
const TODAY = '2026-11-09';
let db: SqlDriver;
const ctx = () => ({ db, ownerId: 'local', newId: randomUUID, now: () => NOW });

async function empty(): Promise<SqlDriver> {
  db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  return db;
}
const routineDraft = (patch: Partial<RoutineDraft> = {}): RoutineDraft => ({
  ...emptyRoutineDraft(1),
  title: 'Morning',
  steps: [
    { title: 'Water', durationMin: 1 },
    { title: 'Stretch', durationMin: null },
  ],
  ...patch,
});

beforeEach(async () => {
  jest.clearAllMocks();
  useSession.setState({ status: 'starting', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
  await flushDeletes();
  usePendingDeletes.setState({ pending: [] });
});

describe('Routines tab', () => {
  it('shows an empty state that creates a routine', async () => {
    await renderWithProviders(<RoutinesScreen now={NOW} />, { open: empty });
    expect(await screen.findByText('No routines yet')).toBeTruthy();
    await fireEvent.press(screen.getByText('Create a routine'));
    expect(mockRouter.push).toHaveBeenCalledWith('/routine/new');
  });

  it('lists routines with steps, minutes and today state, and opens one', async () => {
    await empty();
    const r = await createRoutine(ctx(), routineDraft());
    await renderWithProviders(<RoutinesScreen now={NOW} />, { open: async () => db });
    const card = await screen.findByTestId(`routine-card-${r.id}`);
    expect(card.props.accessibilityLabel).toMatch(/Morning.*2 steps.*1 min.*Planned today/);
    await fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/routine/[id]', params: { id: r.id } });
  });

  it('hides a routine while its delete is pending', async () => {
    await empty();
    const r = await createRoutine(ctx(), routineDraft());
    await renderWithProviders(<RoutinesScreen now={NOW} />, { open: async () => db });
    await screen.findByTestId(`routine-card-${r.id}`);
    await act(async () => {
      usePendingDeletes.setState({
        pending: [{ id: 'x', label: 'Morning', kind: 'routine', hide: { routineId: r.id } }],
      });
    });
    expect(screen.queryByTestId(`routine-card-${r.id}`)).toBeNull();
    expect(screen.getByText('No routines yet')).toBeTruthy();
  });
});

describe('Routine editor', () => {
  it('creates a routine with ordered steps and a reminder', async () => {
    await renderWithProviders(<RoutineEditorScreen now={NOW} />, { open: empty });
    await fireEvent.changeText(await screen.findByTestId('routine-title'), 'Evening wind-down');
    await fireEvent.press(screen.getByTestId('routine-part-evening'));
    await fireEvent.press(screen.getByTestId('add-step'));
    await fireEvent.press(screen.getByTestId('add-step'));
    await fireEvent.changeText(screen.getByTestId('routine-step-title-0'), 'Tidy up');
    await fireEvent.changeText(screen.getByTestId('routine-step-title-1'), 'Read');
    await fireEvent.press(screen.getByTestId('routine-step-minutes-0-next'));
    await fireEvent.press(screen.getByTestId('routine-step-down-0'));
    expect(screen.getByTestId('routine-step-up-0')).toBeDisabled();

    await fireEvent(screen.getByTestId('item-reminder-switch'), 'valueChange', true);
    await fireEvent.press(await screen.findByTestId('item-reminder-allow'));
    await fireEvent.press(await screen.findByTestId('save-routine'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(mockRouter.replace.mock.calls[0]?.[0]).toMatchObject({ pathname: '/routine/[id]' });

    const row = await db.first<{ id: string; part_of_day: string }>(
      "SELECT id, part_of_day FROM routines WHERE title = 'Evening wind-down'",
    );
    expect(row?.part_of_day).toBe('evening');
    const detail = await getRoutineDetail(db, 'local', row!.id, TODAY);
    expect(detail?.routine.steps.map((s) => [s.title, s.durationMin ?? null])).toEqual([
      ['Read', null],
      ['Tidy up', 1],
    ]);
    expect(detail?.reminder).not.toBeNull();
  });

  it('asks for a name and at least one step before saving', async () => {
    await renderWithProviders(<RoutineEditorScreen now={NOW} />, { open: empty });
    await fireEvent.press(await screen.findByTestId('save-routine'));
    expect(await screen.findByText('Give the routine a name.')).toBeTruthy();
    expect(screen.getByTestId('routine-steps-error')).toHaveTextContent('A routine needs at least one step.');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'X');
    await fireEvent.press(screen.getByTestId('add-step'));
    await fireEvent.press(screen.getByTestId('save-routine'));
    expect(await screen.findByText('Give each step a name.')).toBeTruthy();
  });

  it('edits an existing routine and removes a step', async () => {
    await empty();
    const r = await createRoutine(ctx(), routineDraft());
    await renderWithProviders(<RoutineEditorScreen routineId={r.id} now={NOW} />, { open: async () => db });
    expect(await screen.findByDisplayValue('Morning')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('routine-step-remove-1'));
    await fireEvent.changeText(screen.getByTestId('routine-title'), 'Morning start');
    await fireEvent.press(screen.getByTestId('save-routine'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const detail = await getRoutineDetail(db, 'local', r.id, TODAY);
    expect(detail?.routine.title).toBe('Morning start');
    expect(detail?.routine.steps).toHaveLength(1);
  });

  it('delete asks first, hides the routine and can be undone or committed', async () => {
    await empty();
    const r = await createRoutine(ctx(), routineDraft());
    await renderWithProviders(<RoutineEditorScreen routineId={r.id} now={NOW} />, { open: async () => db });
    await fireEvent.press(await screen.findByTestId('delete-routine'));
    await fireEvent.press(screen.getByTestId('confirm-delete-routine'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/routines');
    const pending = usePendingDeletes.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'routine', hide: { routineId: r.id } });
    undoDelete(pending[0]!.id);
    await flushDeletes();
    expect(await getRoutineDetail(db, 'local', r.id, TODAY)).not.toBeNull();

    await fireEvent.press(screen.getByTestId('delete-routine'));
    await fireEvent.press(screen.getByTestId('confirm-delete-routine'));
    await flushDeletes();
    expect(await getRoutineDetail(db, 'local', r.id, TODAY)).toBeNull();
  });

  it('shows a not-found state for an unknown routine', async () => {
    await renderWithProviders(<RoutineEditorScreen routineId="nope" now={NOW} />, { open: empty });
    expect(await screen.findByText('This routine no longer exists.')).toBeTruthy();
  });
});

describe('Routine screen and runner', () => {
  it('shows the overview, runs the steps, and records the run', async () => {
    await empty();
    const r = await createRoutine(
      ctx(),
      routineDraft({ startTime: '07:00', reminder: { offsetMin: 10, atTime: '09:00' } }),
    );
    await renderWithProviders(<RoutineScreen routineId={r.id} now={NOW} />, { open: async () => db });
    expect(await screen.findByTestId('routine-overview')).toBeTruthy();
    expect(screen.getByTestId('routine-today-status')).toHaveTextContent('Planned today');
    expect(screen.getByTestId('routine-reminder')).toHaveTextContent('10 minutes before');
    expect(screen.getByTestId('routine-schedule')).toHaveTextContent(/Every day/);
    expect(screen.getByTestId('routine-step-row-1')).toHaveTextContent(/Stretch/);

    await fireEvent.press(screen.getByTestId('routine-start'));
    expect(await screen.findByTestId('routine-runner')).toBeTruthy();
    expect(screen.getByTestId('routine-current-step')).toHaveTextContent('Water');
    expect(screen.getByTestId('routine-step-of')).toHaveTextContent(/Step 1 of 2/);
    expect(screen.getByTestId('routine-timer')).toHaveTextContent(/left/);
    expect(screen.getByTestId('routine-back-step')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('routine-pause'));
    expect(screen.getByTestId('routine-step-of')).toHaveTextContent(/Paused/);
    await fireEvent.press(screen.getByTestId('routine-pause'));
    await fireEvent.press(screen.getByTestId('routine-done'));
    expect(screen.getByTestId('routine-current-step')).toHaveTextContent(/Stretch/);
    expect(screen.getByTestId('routine-timer')).toHaveTextContent(/elapsed/);
    await fireEvent.press(screen.getByTestId('routine-skip'));

    expect(await screen.findByTestId('routine-finished')).toBeTruthy();
    expect(screen.getByTestId('routine-finished-summary')).toHaveTextContent(/1 of 2 steps done/);
    await waitFor(async () => expect((await getRoutineDetail(db, 'local', r.id, TODAY))?.today.done).toBe(true));
    const detail = await getRoutineDetail(db, 'local', r.id, TODAY);
    expect(detail?.today.completedStepIds).toEqual([r.steps[0]!.id]);

    await fireEvent.press(screen.getByTestId('routine-close-run'));
    await waitFor(() => expect(screen.getByTestId('routine-today-status')).toHaveTextContent('Done today'));
    expect(screen.getByTestId('routine-runs')).toHaveTextContent(/1 of 2 steps/);
  });

  it('can end a run early; nothing done leaves the day open', async () => {
    await empty();
    const r = await createRoutine(ctx(), routineDraft());
    await renderWithProviders(<RoutineScreen routineId={r.id} now={NOW} />, { open: async () => db });
    await fireEvent.press(await screen.findByTestId('routine-start'));
    await fireEvent.press(await screen.findByTestId('routine-finish'));
    expect(await screen.findByTestId('routine-finished')).toHaveTextContent(/2 not reached/);
    await fireEvent.press(screen.getByTestId('routine-close-run'));
    await waitFor(() => expect(screen.getByTestId('routine-today-status')).toHaveTextContent('Planned today'));
  });

  it('shows an empty state for an unknown routine and offers the way back', async () => {
    await renderWithProviders(<RoutineScreen routineId="nope" now={NOW} />, { open: empty });
    expect(await screen.findByText('This routine no longer exists.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Back', { exact: true }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('renders in French', async () => {
    await empty();
    const r = await createRoutine(ctx(), routineDraft());
    await renderWithProviders(<RoutineScreen routineId={r.id} now={NOW} />, { open: async () => db, language: 'fr' });
    expect(await screen.findByText('Démarrer la routine')).toBeTruthy();
    expect(screen.getByTestId('routine-today-status')).toHaveTextContent('Prévue aujourd’hui');
  });
});

describe('Task reminder field', () => {
  it('saves a reminder offset on a timed task and shows it on the details screen', async () => {
    await empty();
    const task = await createTask(ctx(), { ...emptyDraft(TODAY), title: 'Call Sam', startTime: '09:00' });
    await renderWithProviders(<TaskEditorScreen taskId={task.id} now={NOW} />, { open: async () => db });
    await fireEvent(await screen.findByTestId('item-reminder-switch'), 'valueChange', true);
    await fireEvent.press(await screen.findByTestId('item-reminder-allow'));
    await fireEvent.press(await screen.findByTestId('item-reminder-offset-30'));
    await fireEvent.press(screen.getByTestId('save-task'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await getItemReminder(db, 'local', 'task', task.id)).toMatchObject({ offsetMin: 30 });
  });

  it('Android without exact alarms: explains the access before opening the setting, keeps the reminder', async () => {
    const adapter = jest.requireActual<typeof import('../../src/services/notifications/expoNotifications')>(
      '../../src/services/notifications/expoNotifications',
    );
    const state = jest.spyOn(adapter, 'getExactAlarmState').mockResolvedValue('askable');
    const request = jest.spyOn(adapter, 'requestExactAlarm').mockResolvedValue('granted');
    try {
      await empty();
      const task = await createTask(ctx(), { ...emptyDraft(TODAY), title: 'Call Sam', startTime: '09:00' });
      await renderWithProviders(<TaskEditorScreen taskId={task.id} now={NOW} />, { open: async () => db });
      await fireEvent(await screen.findByTestId('item-reminder-switch'), 'valueChange', true);
      await fireEvent.press(await screen.findByTestId('item-reminder-allow'));
      // The explanation comes first; "Not now" keeps the reminder and leaves a note to come back to it.
      expect(await screen.findByText('Ring reminders on time?')).toBeTruthy();
      expect(request).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByText('Not now'));
      expect(await screen.findByTestId('item-reminder-inexact')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('item-reminder-exact'));
      await fireEvent.press(await screen.findByTestId('item-reminder-exact-allow'));
      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByTestId('item-reminder-inexact')).toBeNull());
      await fireEvent.press(screen.getByTestId('save-task'));
      await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
      expect(await getItemReminder(db, 'local', 'task', task.id)).toMatchObject({ offsetMin: 10 });
    } finally {
      state.mockRestore();
      request.mockRestore();
    }
  });

  it('offers a time of day for a task without a start time', async () => {
    await empty();
    const task = await createTask(ctx(), { ...emptyDraft(TODAY), title: 'Water plants' });
    await renderWithProviders(<TaskEditorScreen taskId={task.id} now={NOW} />, { open: async () => db });
    await fireEvent(await screen.findByTestId('item-reminder-switch'), 'valueChange', true);
    await fireEvent.press(await screen.findByTestId('item-reminder-allow'));
    expect(await screen.findByTestId('item-reminder-time')).toBeTruthy();
    expect(screen.queryByTestId('item-reminder-offset-30')).toBeNull();
  });

  it('details show the real reminder, or that there is none', async () => {
    await empty();
    const timed = await createTask(ctx(), {
      ...emptyDraft(TODAY),
      title: 'Timed',
      startTime: '09:00',
      reminder: { offsetMin: 60, atTime: '09:00' },
    });
    await renderWithProviders(<TaskDetailScreen taskId={timed.id} now={NOW} />, { open: async () => db });
    expect(await screen.findByTestId('detail-reminders')).toHaveTextContent('1 hour before');
  });

  it('details say so when a task has no reminder', async () => {
    await empty();
    const plain = await createTask(ctx(), { ...emptyDraft(TODAY), title: 'Plain' });
    await renderWithProviders(<TaskDetailScreen taskId={plain.id} now={NOW} />, { open: async () => db });
    expect(await screen.findByTestId('detail-reminders')).toHaveTextContent('No reminder.');
  });
});
