/**
 * Synthetic demo data (no real people, places or personal data). Used by scripts/seed.ts and by tests.
 * Rows are plain column maps so the seed does not depend on phase 3 repositories.
 */
import { addDays, format } from 'date-fns';

import type { SqlDriver, SqlValue } from '../db/driver';

export const LOCAL_OWNER = 'local';

/** Demo strings per language (synthetic; French is fr-CA wording). */
export const demoStrings = {
  en: {
    focus: 'Focus work',
    health: 'Health',
    home: 'Home',
    learning: 'Learning',
    goalRun: 'Run a 10 km race',
    goalRunDesc: 'Build up from three short runs a week.',
    goalCourse: 'Finish the design course',
    goalHome: 'Keep the home tidy',
    easyRun: 'Easy 3 km run',
    m3: 'Run 3 km without stopping',
    m5: 'Run 5 km',
    m8: 'Run 8 km',
    review: 'Review the weekly plan',
    outline: 'Draft the project outline',
    walk: 'Lunch walk',
    plants: 'Water the plants',
    read: 'Read one chapter',
    dentist: 'Book a dentist appointment',
    weekend: 'Plan the weekend',
    photos: 'Sort old photos',
    stretch: 'Stretch break',
    outlineSub1: 'List the main sections',
    outlineSub2: 'Write the summary',
    outlineSub3: 'Add the timeline',
    outlineNotes: 'Keep it to two pages and share it with the team on Friday.',
    checkin: 'Team check-in',
    walkNotes: 'Easy pace, 20 minutes out and back.',
    routine: 'Morning start',
    water: 'Glass of water',
    stretchStep: 'Stretch',
    priorities: 'Pick three priorities',
    planner: 'Demo planner',
  },
  fr: {
    focus: 'Travail concentré',
    health: 'Santé',
    home: 'Maison',
    learning: 'Apprentissage',
    goalRun: 'Courir un 10 km',
    goalRunDesc: 'Progresser avec trois courtes sorties par semaine.',
    goalCourse: 'Terminer le cours de design',
    goalHome: 'Garder la maison en ordre',
    easyRun: 'Sortie facile de 3 km',
    m3: 'Courir 3 km sans arrêt',
    m5: 'Courir 5 km',
    m8: 'Courir 8 km',
    review: 'Revoir le plan de la semaine',
    outline: 'Ébaucher le plan du projet',
    walk: 'Marche du midi',
    plants: 'Arroser les plantes',
    read: 'Lire un chapitre',
    dentist: 'Prendre rendez-vous chez le dentiste',
    weekend: 'Planifier la fin de semaine',
    photos: 'Trier les vieilles photos',
    stretch: 'Pause étirements',
    outlineSub3: 'Ajouter l’échéancier',
    outlineNotes: 'Deux pages au plus, à partager avec l’équipe vendredi.',
    checkin: 'Point d’équipe',
    walkNotes: 'Rythme facile, 20 minutes aller-retour.',
    outlineSub1: 'Lister les grandes sections',
    outlineSub2: 'Rédiger le résumé',
    routine: 'Bon départ du matin',
    water: 'Verre d’eau',
    stretchStep: 'Étirements',
    priorities: 'Choisir trois priorités',
    planner: 'Planificateur démo',
  },
} as const;

type Row = Record<string, SqlValue>;

export interface DemoData {
  profile: Row[];
  categories: Row[];
  goals: Row[];
  milestones: Row[];
  tasks: Row[];
  routines: Row[];
  recurrence_rules: Row[];
  task_occurrences: Row[];
  reminders: Row[];
}

const day = (d: Date) => format(d, 'yyyy-MM-dd');

export function buildDemoData(options: {
  today: Date;
  newId: () => string;
  ownerId?: string;
  language?: string;
}): DemoData {
  const { today, newId } = options;
  const S = options.language === 'fr' ? demoStrings.fr : demoStrings.en;
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
    cat(S.focus, 'ember', 'target', 0),
    cat(S.health, 'moss', 'heart', 1),
    cat(S.home, 'sand', 'home', 2),
    cat(S.learning, 'plum', 'book', 3),
  ];
  const [focus, health, home, learning] = categories.map((c) => c.id as string) as [string, string, string, string];

  const goalReminders = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      beforeDue: [],
      beforeDueTime: '09:00',
      eachStep: false,
      monthlyDay: null,
      monthlyTime: '09:00',
      periodic: false,
      periodicTime: '09:00',
      periodicWeekday: 1,
      ...over,
    });
  // Every demo goal has at least one linked task (the app's rule).
  const goalId = newId();
  const courseGoalId = newId();
  const homeGoalId = newId();
  const weekStart = addDays(today, -((today.getDay() + 6) % 7)); // Monday of this week
  const goals: Row[] = [
    {
      ...base(goalId),
      title: S.goalRun,
      description: S.goalRunDesc,
      target_date: day(addDays(today, 41)),
      status: 'active',
      color: 'moss',
      progress_mode: 'tasks',
      manual_progress: 0,
      achieved_at: null,
      period: 'once',
      start_date: day(addDays(today, -14)),
      reminders: goalReminders({ beforeDue: [1, 7], eachStep: true }),
      history: '[]',
    },
    {
      ...base(courseGoalId),
      title: S.goalCourse,
      description: null,
      target_date: day(addDays(today, 90)),
      status: 'active',
      color: 'plum',
      progress_mode: 'tasks',
      manual_progress: 0,
      achieved_at: null,
      period: 'once',
      start_date: null,
      reminders: goalReminders({ monthlyDay: 1 }),
      history: '[]',
    },
    {
      ...base(homeGoalId),
      title: S.goalHome,
      description: null,
      target_date: null,
      status: 'active',
      color: 'sand',
      progress_mode: 'tasks',
      manual_progress: 0,
      achieved_at: null,
      period: 'weekly',
      start_date: day(addDays(weekStart, -14)),
      reminders: goalReminders({ periodic: true, periodicTime: '18:00', periodicWeekday: 0 }),
      history: JSON.stringify([
        { start: day(addDays(weekStart, -14)), end: day(addDays(weekStart, -8)), percent: 50, done: 1, total: 2 },
        { start: day(addDays(weekStart, -7)), end: day(addDays(weekStart, -1)), percent: 100, done: 2, total: 2 },
      ]),
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
  const milestones = [milestone(S.m3, -10, true, 0), milestone(S.m5, 10, false, 1), milestone(S.m8, 28, false, 2)];

  const task = (
    title: string,
    opts: {
      date?: Date | null;
      start?: string | null;
      duration?: number | null;
      category?: string;
      priority?: number;
      notes?: string;
      goal?: string;
    },
  ): Row => ({
    ...base(newId()),
    title,
    notes: opts.notes ?? null,
    status: 'open',
    priority: opts.priority ?? 0,
    category_id: opts.category ?? null,
    goal_id: opts.goal ?? null,
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
    task(S.review, { start: '08:30', duration: 30, category: focus, priority: 2 }),
    task(S.outline, { start: '09:30', duration: 90, category: focus, priority: 3, notes: S.outlineNotes }),
    task(S.walk, { start: '12:30', duration: 30, category: health, notes: S.walkNotes, goal: goalId }),
    task(S.plants, { category: home, goal: homeGoalId }),
    task(S.read, { start: '20:00', duration: 40, category: learning, goal: courseGoalId }),
    task(S.dentist, { date: addDays(today, -2), category: health, priority: 1 }),
    task(S.weekend, { date: addDays(today, 3), category: home, goal: homeGoalId }),
    task(S.photos, { date: null }),
    task(S.checkin, { start: '10:00', duration: 30, category: focus }),
  ];
  const outlineId = tasks[1]?.id as string;
  const subtask = (title: string, done: boolean, sort: number): Row => ({
    ...task(title, { date: null }),
    parent_task_id: outlineId,
    status: done ? 'done' : 'open',
    completed_at: done ? now : null,
    sort_order: sort,
  });
  tasks.push(subtask(S.outlineSub1, true, 0), subtask(S.outlineSub2, false, 1), subtask(S.outlineSub3, false, 2));
  tasks.push({
    ...task(S.easyRun, { date: addDays(today, -1), start: '07:30', duration: 25, category: health, goal: goalId }),
    status: 'done',
    completed_at: now,
  });
  const stretchRuleId = newId();
  const stretch: Row = {
    ...task(S.stretch, { date: addDays(today, -7), start: '15:00', duration: 15, category: health, goal: goalId }),
    recurrence_rule_id: stretchRuleId,
  };
  tasks.push(stretch);

  const routineId = newId();
  const ruleId = newId();
  const routines: Row[] = [
    {
      ...base(routineId),
      title: S.routine,
      part_of_day: 'morning',
      start_time: '07:00',
      steps: JSON.stringify([
        { id: 's1', title: S.water, durationMin: 2 },
        { id: 's2', title: S.stretchStep, durationMin: 10 },
        { id: 's3', title: S.priorities, durationMin: 5 },
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
    {
      ...base(stretchRuleId),
      series_type: 'task',
      series_id: stretch.id as string,
      freq: 'weekly',
      interval: 1,
      by_weekday: JSON.stringify([1, 2, 3, 4, 5]),
      by_month_day: null,
      week_starts_on: 1,
      start_date: day(addDays(today, -7)),
      // A repeating task linked to a goal must end (by the goal's due date): a two-week block, 10 weekdays.
      end_type: 'onDate',
      end_date: day(addDays(today, 6)),
      count: null,
    },
  ];

  // Last week's stretch breaks are done, so the goal reads "6 of 12" (5 breaks + the easy run) instead of "1 of 37".
  const task_occurrences: Row[] = [];
  for (let back = 7; back >= 1; back -= 1) {
    const date = addDays(today, -back);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    task_occurrences.push({
      ...base(`${stretch.id as string}_${format(date, 'yyyyMMdd')}`),
      series_type: 'task',
      series_id: stretch.id as string,
      rule_id: stretchRuleId,
      original_date: day(date),
      date: day(date),
      start_time: null,
      duration_min: null,
      title: null,
      notes: null,
      status: 'done',
      completed_at: now,
      completed_step_ids: '[]',
      is_exception: 1,
    });
  }

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
      display_name: S.planner,
      time_zone: 'America/Toronto',
      // Same default as a first run: Monday in French, Sunday in English (the week start is a setting now).
      week_starts_on: options.language === 'fr' ? 1 : 0,
      theme: 'system',
      day_start: '06:00',
      day_end: '19:00',
      daily_capacity_min: 360,
      default_reminder_offset_min: 10,
      onboarding_completed_at: now,
    },
  ];

  return { profile, categories, goals, milestones, tasks, routines, recurrence_rules, task_occurrences, reminders };
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
