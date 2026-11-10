import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { randomUUID } from 'crypto';

import { getBoundUid } from '../../src/data/account';
import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { buildDemoData, insertDemoData } from '../../src/data/seed/demoData';
import { createTask, emptyDraft } from '../../src/data/tasks';
import { occurrenceId } from '../../src/domain/recurrence/generator';
import { AuthScreen } from '../../src/features/auth/AuthScreen';
import { CalendarScreen } from '../../src/features/calendar/CalendarScreen';
import { OnboardingScreen } from '../../src/features/onboarding/OnboardingScreen';
import { MeScreen } from '../../src/features/settings/MeScreen';
import { parseTimeInput, TaskEditorScreen } from '../../src/features/tasks/TaskEditorScreen';
import { TodayScreen } from '../../src/features/today/TodayScreen';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { NARROW_LOCK_CSS } from '../../src/ui/webLayout';
import { context } from '../support/db';
import { createFakeAuth } from '../support/fakeAuth';
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
const opener = (d: () => Promise<SqlDriver>) => () => d();

beforeEach(() => {
  jest.clearAllMocks();
  useSession.setState({ status: 'starting', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
});

describe('Today on real data', () => {
  it('groups the day, sums the workload and checks a task off into Done', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: opener(() => seeded()) });
    expect(await screen.findByTestId('state-success')).toBeTruthy();
    const scheduled = screen.getByTestId('group-scheduled');
    expect(within(scheduled).getByText('Draft the project outline')).toBeTruthy();
    expect(within(scheduled).getByText('Stretch break')).toBeTruthy(); // recurring occurrence (Mon-Fri)
    expect(within(screen.getByTestId('group-overdue')).getByText('Book a dentist appointment')).toBeTruthy();
    expect(within(screen.getByTestId('group-routines')).getByText('Morning start')).toBeTruthy();
    expect(screen.getByText('3h 55m of 6h planned')).toBeTruthy();
    expect(within(scheduled).getByText(/1\/3 subtasks/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Mark “Draft the project outline” done' }));
    await waitFor(() => expect(screen.getByTestId('group-done')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Done, 1' }));
    expect(within(screen.getByTestId('group-done')).getByText('Draft the project outline')).toBeTruthy();
    expect(within(screen.getByTestId('group-scheduled')).queryByText('Draft the project outline')).toBeNull();
  });

  it('shows French demo data when the app runs in French', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: opener(() => seeded('fr')), language: 'fr' });
    expect(await screen.findByText('Ébaucher le plan du projet')).toBeTruthy();
    expect(screen.getByText('Pause étirements')).toBeTruthy();
    expect(screen.getAllByText(/En retard/).length).toBeGreaterThan(0);
  });

  it('opens the details of a recurring occurrence with its occurrence id', async () => {
    await renderWithProviders(<TodayScreen now={NOW} />, { open: opener(() => seeded()) });
    await fireEvent.press(await screen.findByRole('button', { name: /^Stretch break,/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/task/details/[id]',
      params: expect.objectContaining({ occ: expect.stringMatching(/_20261109$/) }),
    });
  });
});

describe('Task editor', () => {
  it('validates the title inline', async () => {
    await renderWithProviders(<TaskEditorScreen now={NOW} />, { open: opener(fresh) });
    await fireEvent.press(screen.getByTestId('save-task'));
    expect(await screen.findByText('Give the task a title.')).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('creates a weekly task with a subtask and shows the next dates', async () => {
    await renderWithProviders(<TaskEditorScreen now={NOW} />, { open: opener(fresh) });
    await fireEvent.changeText(screen.getByTestId('field-title'), 'Team check-in');
    await fireEvent.press(screen.getByTestId('field-time'));
    await fireEvent.press(screen.getByTestId('field-time-option-09:30'));
    await fireEvent.press(screen.getByTestId('field-duration'));
    await fireEvent.press(screen.getByTestId('field-duration-option-30'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Weekly' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Thu' }));
    expect(screen.getByTestId('repeat-preview')).toHaveTextContent('Next: Mon 9, Thu 12, Mon 16');
    await fireEvent.changeText(screen.getByTestId('field-subtask'), 'Prepare notes');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await fireEvent.press(screen.getByTestId('save-task'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());

    const task = await db.first<{ id: string; start_time: string; duration_min: number; recurrence_rule_id: string }>(
      "SELECT id, start_time, duration_min, recurrence_rule_id FROM tasks WHERE title = 'Team check-in'",
    );
    expect(task).toMatchObject({ start_time: '09:30', duration_min: 30 });
    const rule = await db.first<{ by_weekday: string }>('SELECT by_weekday FROM recurrence_rules WHERE id = ?', [
      task!.recurrence_rule_id,
    ]);
    expect(JSON.parse(rule!.by_weekday)).toEqual([1, 4]);
    expect((await db.all('SELECT id FROM tasks WHERE parent_task_id = ?', [task!.id])).length).toBe(1);
  });

  it('asks "this / following / all" when saving an occurrence, and saves only this one', async () => {
    await fresh();
    const ctx = context(db, 'local', () => NOW);
    const series = await createTask(ctx, {
      ...emptyDraft(TODAY),
      title: 'Gym',
      repeat: {
        freq: 'daily',
        interval: 1,
        byWeekday: null,
        byMonthDay: null,
        weekStartsOn: 1,
        endType: 'never',
        endDate: null,
        count: null,
      },
    });
    const occ = occurrenceId(series.id, '2026-11-10');
    await renderWithProviders(<TaskEditorScreen now={NOW} taskId={series.id} occurrenceId={occ} />, {
      open: async () => db,
    });
    await fireEvent.changeText(await screen.findByTestId('field-title'), 'Gym (short)');
    await fireEvent.press(screen.getByTestId('save-task'));
    expect(await screen.findByTestId('scope-this')).toBeTruthy();
    expect(screen.getByTestId('scope-following')).toBeTruthy();
    expect(screen.getByTestId('scope-all')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('scope-this'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const row = await db.first<{ title: string; is_exception: number }>(
      'SELECT title, is_exception FROM task_occurrences WHERE id = ?',
      [occ],
    );
    expect(row).toEqual({ title: 'Gym (short)', is_exception: 1 });
    expect((await db.first<{ title: string }>('SELECT title FROM tasks WHERE id = ?', [series.id]))?.title).toBe('Gym');
  });

  it('parses friendly time input', () => {
    expect(parseTimeInput('9:30')).toBe('09:30');
    expect(parseTimeInput('0930')).toBe('09:30');
    expect(parseTimeInput('9h30')).toBe('09:30');
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput('24:00')).toBeUndefined();
  });
});

describe('Calendar', () => {
  it('shows the week strip with load and a seven-day agenda', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} initialView="week" />, { open: opener(() => seeded()) });
    expect(await screen.findByTestId('strip-2026-11-09')).toBeTruthy();
    expect(screen.getByTestId('week-day-2026-11-09')).toBeTruthy();
    expect(screen.getByTestId('week-day-2026-11-12')).toBeTruthy(); // "Plan the weekend" + stretch break
    await fireEvent.press(screen.getByTestId('calendar-nav-next'));
    expect(await screen.findByTestId('strip-2026-11-16')).toBeTruthy();
  });

  it('previews the selected day under the month grid', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} initialView="month" />, { open: opener(() => seeded()) });
    const preview = await screen.findByTestId('month-preview');
    expect(within(preview).getByText('Draft the project outline')).toBeTruthy();
  });
});

describe('Onboarding', () => {
  it('walks through the cards and continues as a guest with starter categories', async () => {
    usePreferences.setState({ onboardingDone: false });
    await renderWithProviders(<OnboardingScreen />, { open: opener(fresh) });
    expect(screen.getByText('VIZAM portfolio concept')).toBeTruthy();
    for (let i = 0; i < 3; i += 1) await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-guest'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(usePreferences.getState().onboardingDone).toBe(true);
    expect((await db.all('SELECT id FROM categories')).length).toBe(4);
  });
});

describe('Auth', () => {
  it('validates fields and shows one message for bad credentials', async () => {
    const gateway = createFakeAuth({ 'planner@example.test': 'correct-horse-1' });
    await renderWithProviders(<AuthScreen mode="signIn" />, { open: opener(fresh), gateway });
    await fireEvent.changeText(screen.getByTestId('field-email'), 'not-an-email');
    await fireEvent.press(screen.getByTestId('auth-submit'));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('field-email'), 'nobody@example.test');
    await fireEvent.changeText(screen.getByTestId('field-password'), 'whatever-1');
    await fireEvent.press(screen.getByTestId('auth-submit'));
    expect(await screen.findByTestId('auth-error')).toHaveTextContent(
      'That email and password do not match. Try again or reset your password.',
    );
  });

  it('creates an account, keeps guest plans and signs in', async () => {
    const gateway = createFakeAuth();
    await fresh();
    await createTask(
      context(db, 'local', () => NOW),
      { ...emptyDraft(TODAY), title: 'Guest plan' },
    );
    await renderWithProviders(<AuthScreen mode="signUp" />, { open: async () => db, gateway });
    expect(await screen.findByText('1 plan on this device will be added to your account.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('field-email'), 'New@Example.test');
    await fireEvent.changeText(screen.getByTestId('field-password'), 'long-enough-1');
    await fireEvent.press(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(useSession.getState().status).toBe('signedIn');
    const uid = useSession.getState().uid!;
    expect(await getBoundUid(db)).toBe(uid);
    expect(await db.first('SELECT title FROM tasks WHERE owner_id = ?', [uid])).toEqual({ title: 'Guest plan' });
  });

  it('explains when accounts are unavailable in this build', async () => {
    await renderWithProviders(<AuthScreen mode="signIn" />, { open: opener(fresh), gateway: null });
    expect(await screen.findByText(/Accounts are not available in this build/)).toBeTruthy();
    expect(screen.getByTestId('auth-submit')).toBeDisabled();
  });

  it('reset never says whether the account exists', async () => {
    const gateway = createFakeAuth();
    await renderWithProviders(<AuthScreen mode="reset" />, { open: opener(fresh), gateway });
    await fireEvent.changeText(screen.getByTestId('field-email'), 'unknown@example.test');
    await fireEvent.press(screen.getByTestId('auth-submit'));
    expect(await screen.findByTestId('reset-sent')).toBeTruthy();
  });
});

describe('Me', () => {
  it('signs out after warning about unsynced changes and wipes the device', async () => {
    const gateway = createFakeAuth({ 'planner@example.test': 'correct-horse-1' });
    await fresh();
    await gateway.signIn('planner@example.test', 'correct-horse-1');
    await renderWithProviders(<MeScreen />, { open: async () => db, gateway });
    await waitFor(() => expect(useSession.getState().status).toBe('signedIn'));
    const uid = useSession.getState().uid!;
    await act(async () => {
      await createTask(
        context(db, uid, () => NOW),
        { ...emptyDraft(TODAY), title: 'Unsynced' },
      );
    });
    await fireEvent.press(await screen.findByTestId('sign-out'));
    expect(await screen.findByText(/not reached your account yet/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-sign-out'));
    await waitFor(() => expect(useSession.getState().status).toBe('guest'));
    expect((await db.all('SELECT id FROM tasks')).length).toBe(0);
  });
});

describe('web layout', () => {
  it('locks the layout at 500 px below 250 px and lets visitors pan', () => {
    expect(NARROW_LOCK_CSS).toContain('html { overflow-x: auto; }');
    expect(NARROW_LOCK_CSS).toContain('@media (max-width: 250px)');
    expect(NARROW_LOCK_CSS).toMatch(/#root \{ width: 500px/);
    expect(NARROW_LOCK_CSS).toMatch(/right: auto/);
  });
});
