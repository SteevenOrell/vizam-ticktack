/**
 * Minimal goal access for phase 3: list active goals for the task editor's goal selector and create a goal from a
 * name. Full goal screens (milestones, progress) are phase 4.
 */
import { goalSchema, type Goal } from '../domain/models';
import type { SqlDriver } from './db/driver';
import { mutate, writeEntity, type DataContext } from './store';

export interface GoalOption {
  id: string;
  title: string;
}

export async function getGoalOptions(db: SqlDriver, ownerId: string): Promise<GoalOption[]> {
  return db.all<GoalOption>(
    `SELECT id, title FROM goals WHERE owner_id = ? AND deleted = 0 AND status = 'active'
     ORDER BY created_at LIMIT 100`,
    [ownerId],
  );
}

export const goalTitleSchema = goalSchema.shape.title;

/** Creates an active goal with only a title (progress counted from linked tasks). */
export async function createGoal(ctx: DataContext, title: string): Promise<Goal> {
  const clean = goalTitleSchema.parse(title);
  return mutate(ctx, () =>
    writeEntity(ctx, 'goals', {
      id: ctx.newId(),
      title: clean,
      description: null,
      targetDate: null,
      status: 'active',
      color: null,
      progressMode: 'tasks',
      manualProgress: 0,
      achievedAt: null,
    }),
  );
}
