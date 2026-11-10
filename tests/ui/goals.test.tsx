import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'crypto';
import { View } from 'react-native';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { buildDemoData, insertDemoData } from '../../src/data/seed/demoData';
import { CalendarScreen } from '../../src/features/calendar/CalendarScreen';
import { GoalDetailScreen } from '../../src/features/goals/GoalDetailScreen';
import { GoalEditorScreen } from '../../src/features/goals/GoalEditorScreen';
import { GoalsScreen } from '../../src/features/goals/GoalsScreen';
import { flushDeletes, UNDO_MS, usePendingDeletes } from '../../src/features/tasks/pendingDeletes';
import { TaskEditorScreen } from '../../src/features/tasks/TaskEditorScreen';
import { UndoSnackbar } from '../../src/features/tasks/UndoSnackbar';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { keyboardOverlap, revealDelta } from '../../src/ui/keyboard';
import { renderWithProviders } from '../support/render';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const NOW = new Date(2026, 10, 9, 10, 30); // Monday
let db: SqlDriver;

async function seeded(): Promise<SqlDriver> {
  db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  await insertDemoData(db, buildDemoData({ today: NOW, newId: randomUUID, language: 'en' }));
  return db;
}

beforeEach(async () => {
  jest.clearAllMocks();
  useSession.setState({ status: 'starting', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
  await flushDeletes();
  usePendingDeletes.setState({ pending: [] });
});

describe('Goals list', () => {
  it('shows cards with period, due date, countdown and percentage in sections', async () => {
    await renderWithProviders(<GoalsScreen now={NOW} />, { open: seeded });
    expect(await screen.findByText('Run a 10 km race')).toBeTruthy();
    expect(screen.getByTestId('goals-section-active')).toBeTruthy();
    expect(screen.getByText('Keep the home tidy')).toBeTruthy();
    expect(screen.getAllByText('Weekly').length).toBeGreaterThan(0);
    expect(screen.getByText(/41 days left/)).toBeTruthy();
    expect(screen.getByLabelText(/Run a 10 km race: \d+% done/)).toBeTruthy();
  });

  it('empty state offers "Create goal"', async () => {
    await renderWithProviders(<GoalsScreen now={NOW} />, {
      open: async () => {
        db = openBetterSqliteDriver(':memory:');
        await migrate(db);
        return db;
      },
    });
    await fireEvent.press(await screen.findByText('Create goal'));
    expect(mockRouter.push).toHaveBeenCalledWith('/goal/new');
  });
});

describe('Create goal', () => {
  it('keeps Save disabled with a message until a task is linked or created, then creates it', async () => {
    await renderWithProviders(<GoalEditorScreen now={NOW} />, { open: seeded });
    await fireEvent.changeText(await screen.findByTestId('goal-title'), 'Learn to swim');
    expect(screen.getByTestId('needs-task-hint')).toHaveTextContent(/at least one task/);
    expect(screen.getByTestId('save-goal')).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId('new-task-title'), 'Book a lesson');
    await fireEvent.press(screen.getByTestId('add-new-task'));
    expect(screen.queryByTestId('needs-task-hint')).toBeNull();
    expect(screen.getByTestId('new-task-0')).toHaveTextContent(/Book a lesson/);

    await fireEvent.press(screen.getByTestId('link-tasks'));
    await fireEvent.changeText(await screen.findByTestId('task-search'), 'plants');
    await fireEvent.press(await screen.findByText('Water the plants'));
    await fireEvent.press(screen.getByTestId('task-picker-done'));

    await fireEvent.press(screen.getByTestId('save-goal'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const goal = await db.first<{ id: string; period: string; target_date: string }>(
      "SELECT id, period, target_date FROM goals WHERE title = 'Learn to swim'",
    );
    expect(goal).toMatchObject({ period: 'once', target_date: '2026-12-09' });
    expect(
      (await db.all<{ title: string }>('SELECT title FROM tasks WHERE goal_id = ? ORDER BY title', [goal!.id])).map(
        (r) => r.title,
      ),
    ).toEqual(['Book a lesson', 'Water the plants']);
  });

  it('a weekly goal shows its start and current period, and reminders are offered', async () => {
    await renderWithProviders(<GoalEditorScreen now={NOW} />, { open: seeded });
    await fireEvent.press(await screen.findByTestId('goal-period-weekly'));
    expect(screen.queryByTestId('goal-due-section')).toBeNull();
    expect(screen.getByTestId('goal-current-period')).toHaveTextContent(/Nov 8.*Nov 14/);
    expect(screen.getByTestId('reminder-periodic')).toBeTruthy();
    await fireEvent(screen.getByTestId('reminder-before-due'), 'valueChange', true);
    expect(screen.getByTestId('reminder-offset-1')).toBeTruthy();
  });
});

async function goalId(title: string) {
  return (await db.first<{ id: string }>('SELECT id FROM goals WHERE title = ?', [title]))!.id;
}

describe('Goal detail, edit and delete', () => {
  it('shows %, countdown, linked tasks (tickable) and reminders', async () => {
    await seeded();
    const id = await goalId('Run a 10 km race');
    await renderWithProviders(<GoalDetailScreen goalId={id} now={NOW} />, { open: async () => db });
    expect(await screen.findByTestId('goal-hero')).toBeTruthy();
    expect(screen.getByTestId('goal-countdown')).toHaveTextContent('41 days left');
    // Easy run (done) + walk (open) + stretch series occurrences in range -> a share is done.
    expect(screen.getByLabelText(/Run a 10 km race: \d+% done/)).toBeTruthy();
    expect(screen.getByText('Easy 3 km run')).toBeTruthy();
    expect(screen.getByTestId('goal-reminders')).toHaveTextContent(/1 day before, 1 week before at/);
  });

  it('delete asks first, says tasks are kept, hides the goal and can be undone', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      await seeded();
      const id = await goalId('Finish the design course');
      await renderWithProviders(
        <View style={{ flex: 1 }}>
          <GoalDetailScreen goalId={id} now={NOW} />
          <UndoSnackbar bottom={100} />
        </View>,
        { open: async () => db },
      );
      await fireEvent.press(await screen.findByTestId('delete-goal'));
      expect(screen.getByText('Its task is kept and unlinked from the goal.')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('confirm-delete-goal'));
      expect(mockRouter.back).toHaveBeenCalled();
      expect(screen.getByTestId('undo-snackbar')).toHaveTextContent(/Goal “Finish the design course” deleted/);
      await fireEvent.press(screen.getByTestId('undo-delete'));
      await act(async () => {
        jest.advanceTimersByTime(UNDO_MS + 100);
      });
      expect(await db.first('SELECT deleted FROM goals WHERE id = ?', [id])).toEqual({ deleted: 0 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('edit loads the goal with its linked tasks and saves changes', async () => {
    await seeded();
    const id = await goalId('Keep the home tidy');
    await renderWithProviders(<GoalEditorScreen goalId={id} now={NOW} />, { open: async () => db });
    expect(await screen.findByDisplayValue('Keep the home tidy')).toBeTruthy();
    expect(screen.getByTestId('goal-tasks-section')).toHaveTextContent(/Tasks · 2/);
    await fireEvent.changeText(screen.getByTestId('goal-title'), 'Tidy home');
    await fireEvent.press(screen.getByTestId('save-goal'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await db.first('SELECT title FROM goals WHERE id = ?', [id])).toEqual({ title: 'Tidy home' });
  });
});

describe('Deleting the last task of a goal', () => {
  it('warns and can archive the goal', async () => {
    await seeded();
    const taskId = (await db.first<{ id: string }>("SELECT id FROM tasks WHERE title = 'Read one chapter'"))!.id;
    await renderWithProviders(<TaskEditorScreen taskId={taskId} now={NOW} />, { open: async () => db });
    await fireEvent.press(await screen.findByTestId('delete-task'));
    await fireEvent.press(screen.getByTestId('confirm-delete'));
    expect(await screen.findByText('Last task of “Finish the design course”')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('last-task-archive'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await db.first("SELECT status FROM goals WHERE title = 'Finish the design course'")).toEqual({
      status: 'archived',
    });
  });
});

describe('Calendar swipe and keyboard math', () => {
  it('month view is wrapped in a swipe pager; arrows still move the month', async () => {
    await renderWithProviders(<CalendarScreen now={NOW} initialView="month" />, { open: seeded });
    expect(await screen.findByTestId('calendar-pager-month')).toBeTruthy();
    expect(screen.getByText('November 2026')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Next month'));
    expect(await screen.findByText('December 2026')).toBeTruthy();
  });

  it('keyboard overlap and reveal distance', () => {
    // View 0..844, keyboard top at 500 -> pad 344; a resized window (view ends at 500) -> 0.
    expect(keyboardOverlap({ y: 0, height: 844 }, 500)).toBe(344);
    expect(keyboardOverlap({ y: 0, height: 500 }, 500)).toBe(0);
    // Field at 600..650 in a frame 80..780, keyboard at 500: scroll 650 - (500 - 16) = 166.
    expect(revealDelta({ y: 600, height: 50 }, { y: 80, height: 700 }, 500)).toBe(166);
    // Already visible -> 0. Footer above the keyboard (frame ends at 430) is the limit.
    expect(revealDelta({ y: 200, height: 50 }, { y: 80, height: 700 }, 500)).toBe(0);
    expect(revealDelta({ y: 400, height: 50 }, { y: 80, height: 350 }, 500)).toBe(36);
    // Taller than the visible area: align its top under the frame top.
    expect(revealDelta({ y: 300, height: 600 }, { y: 80, height: 700 }, 500)).toBe(204);
  });
});
