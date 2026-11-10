/**
 * Low-level goal helpers shared by the goal and task repositories (kept apart from `goals.ts` so `tasks.ts` can use
 * them without an import cycle). Writes must run inside `mutate`.
 */
import { repeatLimitOf, type GoalRepeatIssue, type GoalTiming } from '../domain/goals';
import { localDateOf, type LocalDate } from '../domain/localDate';
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

export const timingOf = (goal: Pick<Goal, 'period' | 'startDate' | 'targetDate' | 'createdAt'>): GoalTiming => ({
  period: goal.period,
  startDate: goal.startDate,
  targetDate: goal.targetDate,
  createdOn: localDateOf(new Date(goal.createdAt)),
});

/** Last day a repeating task linked to this goal may run (null: no limit, but it still has to end). */
export const goalRepeatLimit = (
  goal: Pick<Goal, 'period' | 'startDate' | 'targetDate' | 'createdAt'>,
  today: LocalDate,
): LocalDate | null => repeatLimitOf(timingOf(goal), today);

/** A repeating task linked to a goal has no end, or ends after the goal does. */
export class GoalRepeatError extends Error {
  constructor(readonly issue: GoalRepeatIssue) {
    super(`Goal-linked repeat refused: ${issue}`);
    this.name = 'GoalRepeatError';
  }
}
