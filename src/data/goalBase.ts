/**
 * Low-level goal write shared by the goal and task repositories (kept apart from `goals.ts` so `tasks.ts` can use
 * it without an import cycle). Must run inside `mutate`.
 */
import { DEFAULT_GOAL_REMINDERS, type Goal } from '../domain/models';
import { writeEntity, type DataContext } from './store';

export async function insertGoal(
  ctx: DataContext,
  fields: Partial<Omit<Goal, 'id' | 'ownerId'>> & { title: string },
  id: string = ctx.newId(),
): Promise<Goal> {
  return writeEntity(ctx, 'goals', {
    id,
    description: null,
    targetDate: null,
    status: 'active',
    color: null,
    progressMode: 'tasks',
    manualProgress: 0,
    achievedAt: null,
    period: 'once',
    startDate: null,
    reminders: DEFAULT_GOAL_REMINDERS,
    history: [],
    ...fields,
    title: fields.title.trim(),
  });
}
