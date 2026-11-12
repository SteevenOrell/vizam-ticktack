import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { randomUUID } from 'crypto';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import { loadGoalForm, updateGoal } from '../../src/data/goals';
import { buildDemoData, insertDemoData } from '../../src/data/seed/demoData';
import { GoalDetailScreen } from '../../src/features/goals/GoalDetailScreen';
import { GoalEditorScreen } from '../../src/features/goals/GoalEditorScreen';
import { flushDeletes, usePendingDeletes } from '../../src/features/tasks/pendingDeletes';
import { usePreferences } from '../../src/state/preferences';
import { useSession } from '../../src/state/session';
import { renderWithProviders } from '../support/render';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const NOW = new Date(2026, 10, 9, 10, 30);
let db: SqlDriver;

async function seeded(): Promise<SqlDriver> {
  db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  await insertDemoData(db, buildDemoData({ today: NOW, newId: randomUUID, language: 'en' }));
  return db;
}
const goalId = async (title: string) =>
  (await db.first<{ id: string }>('SELECT id FROM goals WHERE title = ?', [title]))!.id;

beforeEach(async () => {
  jest.clearAllMocks();
  useSession.setState({ status: 'starting', uid: null, email: null, busy: false });
  usePreferences.setState({ onboardingDone: true });
  await flushDeletes();
  usePendingDeletes.setState({ pending: [] });
});

describe('Milestones in the goal editor', () => {
  it('adds, renames, reorders and removes, then saves them in order', async () => {
    await seeded();
    const id = await goalId('Keep the home tidy');
    await renderWithProviders(<GoalEditorScreen goalId={id} now={NOW} />, { open: async () => db });
    expect(await screen.findByTestId('milestones-empty')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('add-milestone'));
    await fireEvent.press(screen.getByTestId('add-milestone'));
    await fireEvent.press(screen.getByTestId('add-milestone'));
    await fireEvent.changeText(screen.getByTestId('milestone-title-0'), 'One');
    await fireEvent.changeText(screen.getByTestId('milestone-title-1'), 'Two');
    await fireEvent.changeText(screen.getByTestId('milestone-title-2'), 'Three');
    expect(screen.getByTestId('milestone-up-0')).toBeDisabled();
    expect(screen.getByTestId('milestone-down-2')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('milestone-down-0'));
    await fireEvent.press(screen.getByTestId('milestone-remove-2'));
    await fireEvent.press(screen.getByTestId('milestone-set-date-0'));
    expect(screen.getByTestId('milestone-date-0')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('save-goal'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const rows = await db.all<{ title: string; sort_order: number; due_date: string | null }>(
      'SELECT title, sort_order, due_date FROM milestones WHERE goal_id = ? AND deleted = 0 ORDER BY sort_order',
      [id],
    );
    expect(rows).toEqual([
      { title: 'Two', sort_order: 0, due_date: '2026-11-09' },
      { title: 'One', sort_order: 1, due_date: null },
    ]);
  });

  it('shows a message and does not save a milestone without a name', async () => {
    await seeded();
    const id = await goalId('Keep the home tidy');
    await renderWithProviders(<GoalEditorScreen goalId={id} now={NOW} />, { open: async () => db });
    await fireEvent.press(await screen.findByTestId('add-milestone'));
    await fireEvent.press(screen.getByTestId('save-goal'));
    expect(await screen.findByTestId('milestones-error')).toHaveTextContent('Give each milestone a name.');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('Milestones on the goal screen', () => {
  it('lists them with "n of m" and checks them off without touching the percentage', async () => {
    await seeded();
    const id = await goalId('Keep the home tidy');
    const ctx = { db, ownerId: 'local', newId: randomUUID, now: () => NOW };
    const form = await loadGoalForm(ctx, id);
    await updateGoal(ctx, id, {
      ...form!.draft,
      milestones: [
        { title: 'Declutter', dueDate: null, done: false },
        { title: 'Deep clean', dueDate: '2026-11-20', done: false },
      ],
    });
    await renderWithProviders(<GoalDetailScreen goalId={id} now={NOW} />, { open: async () => db });
    expect(await screen.findByTestId('goal-milestone-count')).toHaveTextContent('0 of 2 milestones');
    const before = screen.getByLabelText(/Keep the home tidy: \d+% done/).props.accessibilityLabel;

    const box = await screen.findByLabelText('Mark “Declutter” as done');
    expect(box).toBeTruthy();
    await fireEvent.press(box);
    await waitFor(() => expect(screen.getByTestId('goal-milestone-count')).toHaveTextContent('1 of 2 milestones'));
    expect(screen.getByLabelText('Mark “Declutter” as not done')).toBeTruthy();
    expect(screen.getByLabelText(/Keep the home tidy: \d+% done/).props.accessibilityLabel).toBe(before);
  });

  it('shows an empty state when a goal has none', async () => {
    await seeded();
    const id = await goalId('Keep the home tidy');
    await renderWithProviders(<GoalDetailScreen goalId={id} now={NOW} />, { open: async () => db });
    expect(await screen.findByTestId('goal-milestones-empty')).toBeTruthy();
  });
});
