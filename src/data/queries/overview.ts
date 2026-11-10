import type { SqlDriver } from '../db/driver';

/** Read models for the phase 2 placeholder screens. Phase 3 replaces them with repositories. */
export const LOCAL_OWNER = 'local';

export interface TodaySummary {
  tasks: { id: string; title: string; startTime: string | null; durationMin: number | null }[];
  plannedMin: number;
  capacityMin: number;
}

export async function getTodaySummary(db: SqlDriver, date: string, ownerId = LOCAL_OWNER): Promise<TodaySummary> {
  const tasks = await db.all<{ id: string; title: string; start_time: string | null; duration_min: number | null }>(
    `SELECT id, title, start_time, duration_min FROM tasks
     WHERE owner_id = ? AND date = ? AND deleted = 0 AND status = 'open' AND parent_task_id IS NULL
     ORDER BY start_time IS NULL, start_time, sort_order LIMIT 50`,
    [ownerId, date],
  );
  const profile = await db.first<{ daily_capacity_min: number }>(
    'SELECT daily_capacity_min FROM profile WHERE owner_id = ? AND deleted = 0 LIMIT 1',
    [ownerId],
  );
  return {
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, startTime: t.start_time, durationMin: t.duration_min })),
    plannedMin: tasks.reduce((sum, t) => sum + (t.duration_min ?? 0), 0),
    capacityMin: profile?.daily_capacity_min ?? 480,
  };
}

export async function getActiveGoals(db: SqlDriver, ownerId = LOCAL_OWNER) {
  return db.all<{ id: string; title: string; target_date: string | null }>(
    `SELECT id, title, target_date FROM goals WHERE owner_id = ? AND deleted = 0 AND status = 'active'
     ORDER BY target_date IS NULL, target_date LIMIT 50`,
    [ownerId],
  );
}

export async function getActiveRoutines(db: SqlDriver, ownerId = LOCAL_OWNER) {
  return db.all<{ id: string; title: string; part_of_day: string; steps: string }>(
    `SELECT id, title, part_of_day, steps FROM routines WHERE owner_id = ? AND deleted = 0 AND active = 1
     ORDER BY start_time IS NULL, start_time LIMIT 50`,
    [ownerId],
  );
}

export async function getTasksOn(db: SqlDriver, date: string, ownerId = LOCAL_OWNER) {
  return db.all<{ id: string; title: string; start_time: string | null; duration_min: number | null }>(
    `SELECT id, title, start_time, duration_min FROM tasks
     WHERE owner_id = ? AND date = ? AND deleted = 0 AND start_time IS NOT NULL ORDER BY start_time LIMIT 100`,
    [ownerId, date],
  );
}
