/**
 * Synthetic demo data (no real people, places or personal data). Used by scripts/seed.ts and by tests.
 * Rows are plain column maps so the seed does not depend on phase 3 repositories.
 */
import { addDays, format } from 'date-fns';

import type { SqlDriver, SqlValue } from '../db/driver';

export const LOCAL_OWNER = 'local';

type Row = Record<string, SqlValue>;

export interface DemoData {
  profile: Row[];
  categories: Row[];
  goals: Row[];
  milestones: Row[];
  tasks: Row[];
  routines: Row[];
  recurrence_rules: Row[];
  reminders: Row[];
}

const day = (d: Date) => format(d, 'yyyy-MM-dd');

export function buildDemoData(options: { today: Date; newId: () => string; ownerId?: string }): DemoData {
  const { today, newId } = options;
  const ownerId = options.ownerId ?? LOCAL_OWNER;
  const now = new Date(today).toISOString();
  const base = (id: string): Row => ({
    id,
    owner_id: ownerId,
    created_at: now,
    client_updated_at: now,
    server_updated_at: null,
    deleted: 0,
    schema_version: 1,
    local_rev: 1,
    dirty: 1,
  });

  const cat = (name: string, color: string, icon: string, sort: number): Row => ({
    ...base(newId()),
    name,
    color,
    icon,
    sort_order: sort,
    archived: 0,
  });
  const categories = [
    cat('Focus work', 'ember', 'target', 0),
    cat('Health', 'moss', 'heart', 1),
    cat('Home', 'sand', 'home', 2),
    cat('Learning', 'plum', 'book', 3),
  ];
  const [focus, health, home, learning] = categories.map((c) => c.id as string) as [string, string, string, string];

  const goalId = newId();
  const goals: Row[] = [
    {
      ...base(goalId),
      title: 'Run a 10 km race',
      description: 'Build up from three short runs a week.',
      target_date: day(addDays(today, 41)),
      status: 'active',
      color: 'moss',
      progress_mode: 'milestones',
      manual_progress: 0,
      achieved_at: null,
    },
    {
      ...base(newId()),
      title: 'Finish the design course',
      description: null,
      target_date: day(addDays(today, 90)),
      status: 'active',
      color: 'plum',
      progress_mode: 'tasks',
      manual_progress: 0,
      achieved_at: null,
    },
  ];

  const milestone = (title: string, offset: number, done: boolean, sort: number): Row => ({
    ...base(newId()),
    goal_id: goalId,
    title,
    due_date: day(addDays(today, offset)),
    completed_at: done ? now : null,
    sort_order: sort,
  });
  const milestones = [
    milestone('Run 3 km without stopping', -10, true, 0),
    milestone('Run 5 km', 10, false, 1),
    milestone('Run 8 km', 28, false, 2),
  ];

  const task = (
    title: string,
    opts: { date?: Date | null; start?: string | null; duration?: number | null; category?: string; priority?: number },
  ): Row => ({
    ...base(newId()),
    title,
    notes: null,
    status: 'open',
    priority: opts.priority ?? 0,
    category_id: opts.category ?? null,
    goal_id: null,
    milestone_id: null,
    parent_task_id: null,
    date: opts.date === null ? null : day(opts.date ?? today),
    start_time: opts.start ?? null,
    duration_min: opts.duration ?? null,
    sort_order: 0,
    completed_at: null,
    recurrence_rule_id: null,
  });
  const tasks = [
    task('Review the weekly plan', { start: '08:30', duration: 30, category: focus, priority: 2 }),
    task('Draft the project outline', { start: '09:30', duration: 90, category: focus, priority: 3 }),
    task('Lunch walk', { start: '12:30', duration: 30, category: health }),
    task('Water the plants', { category: home }),
    task('Read one chapter', { start: '20:00', duration: 40, category: learning }),
    task('Book a dentist appointment', { date: addDays(today, -2), category: health, priority: 1 }),
    task('Plan the weekend', { date: addDays(today, 3), category: home }),
    task('Sort old photos', { date: null }),
  ];

  const routineId = newId();
  const ruleId = newId();
  const routines: Row[] = [
    {
      ...base(routineId),
      title: 'Morning start',
      part_of_day: 'morning',
      start_time: '07:00',
      steps: JSON.stringify([
        { id: 's1', title: 'Glass of water', durationMin: 2 },
        { id: 's2', title: 'Stretch', durationMin: 10 },
        { id: 's3', title: 'Pick three priorities', durationMin: 5 },
      ]),
      category_id: health,
      active: 1,
      recurrence_rule_id: ruleId,
    },
  ];
  const recurrence_rules: Row[] = [
    {
      ...base(ruleId),
      series_type: 'routine',
      series_id: routineId,
      freq: 'daily',
      interval: 1,
      by_weekday: null,
      by_month_day: null,
      week_starts_on: 1,
      start_date: day(addDays(today, -14)),
      end_type: 'never',
      end_date: null,
      count: null,
    },
  ];

  const reminders: Row[] = [
    {
      ...base(newId()),
      target_type: 'task',
      target_id: tasks[1]?.id ?? null,
      kind: 'relative',
      offset_min: 10,
      at_time: null,
      enabled: 1,
    },
  ];

  const profile: Row[] = [
    {
      ...base(ownerId === LOCAL_OWNER ? 'local-profile' : ownerId),
      display_name: 'Demo planner',
      time_zone: 'America/Toronto',
      week_starts_on: 1,
      theme: 'system',
      day_start: '06:00',
      day_end: '19:00',
      daily_capacity_min: 360,
      default_reminder_offset_min: 10,
      onboarding_completed_at: now,
    },
  ];

  return { profile, categories, goals, milestones, tasks, routines, recurrence_rules, reminders };
}

const IDENT = /^[a-z_]+$/;

/** Inserts demo rows in one transaction. Table and column names come from our own constants, values are bound. */
export async function insertDemoData(db: SqlDriver, data: DemoData): Promise<number> {
  let count = 0;
  await db.transaction(async () => {
    for (const [table, rows] of Object.entries(data) as [string, Row[]][]) {
      for (const row of rows) {
        const cols = Object.keys(row);
        if (!IDENT.test(table) || !cols.every((c) => IDENT.test(c))) throw new Error('Invalid identifier');
        const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        await db.run(
          sql,
          cols.map((c) => row[c] ?? null),
        );
        count += 1;
      }
    }
  });
  return count;
}
