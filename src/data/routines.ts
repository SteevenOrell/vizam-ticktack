/**
 * Routine use cases: create, edit, delete, the read models of the Routines tab and the routine screen, and the
 * record of a run. A routine is a series like a repeating task: it always has a recurrence rule, its days are
 * generated occurrences (`seriesType = 'routine'`), and a run is stored on the day's occurrence (status, time of
 * completion, the steps that were done in `completedStepIds`). Nothing new is stored for a run, so runs sync through
 * the `occurrences` collection that already exists.
 */
import { z } from 'zod';

import { localDateOf, type LocalDate } from '../domain/localDate';
import { hhmmSchema, type Occurrence, type RecurrenceRule, type Routine, type RuleCore } from '../domain/models';
import { occurrenceId } from '../domain/recurrence/generator';
import { sameSchedule } from '../domain/recurrence/seriesEdit';
import type { SqlDriver } from './db/driver';
import { defaultWindow, ensureOccurrences, resetGenerated } from './occurrences';
import {
  getItemReminder,
  itemReminderSchema,
  removeItemReminders,
  saveItemReminder,
  type ItemReminder,
} from './reminders';
import { getEntity, listEntities, mutate, nowIso, tombstone, writeEntity, type DataContext } from './store';
import { repeatDraftSchema, type RepeatDraft } from './tasks';

export const ROUTINE_STEPS_MAX = 30;
export const PARTS_OF_DAY = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type PartOfDay = (typeof PARTS_OF_DAY)[number];

export const routineStepDraftSchema = z.object({
  /** Missing for a step added in the form. */
  id: z.string().min(1).max(64).optional(),
  title: z.string().trim().min(1, 'stepTitleRequired').max(80, 'stepTitleTooLong'),
  durationMin: z.number().int().min(1).max(600).nullable(),
});
export type RoutineStepDraft = z.infer<typeof routineStepDraftSchema>;

export const routineDraftSchema = z.object({
  title: z.string().trim().min(1, 'titleRequired').max(80, 'titleTooLong'),
  partOfDay: z.enum(PARTS_OF_DAY),
  startTime: hhmmSchema.nullable(),
  steps: z.array(routineStepDraftSchema).min(1, 'needsStep').max(ROUTINE_STEPS_MAX),
  /** A routine always repeats (its days come from the rule). */
  repeat: repeatDraftSchema,
  /** null = no reminder, undefined keeps the stored one. */
  reminder: itemReminderSchema.nullable().optional(),
});
export type RoutineDraft = z.infer<typeof routineDraftSchema>;

export const emptyRoutineDraft = (weekStartsOn: 0 | 1 | 6): RoutineDraft => ({
  title: '',
  partOfDay: 'morning',
  startTime: null,
  steps: [],
  repeat: {
    freq: 'daily',
    interval: 1,
    byWeekday: null,
    byMonthDay: null,
    weekStartsOn,
    endType: 'never',
    endDate: null,
    count: null,
  },
  reminder: null,
});

const todayOf = (ctx: Pick<DataContext, 'now'>) => localDateOf(ctx.now?.() ?? new Date());

function stepsOf(ctx: DataContext, draft: RoutineDraft): Routine['steps'] {
  const used = new Set<string>();
  return draft.steps.map((s) => {
    let id = s.id && !used.has(s.id) ? s.id : ctx.newId();
    while (used.has(id)) id = ctx.newId();
    used.add(id);
    return { id, title: s.title.trim(), durationMin: s.durationMin };
  });
}

export async function createRoutine(ctx: DataContext, input: RoutineDraft): Promise<Routine> {
  const draft = routineDraftSchema.parse(input);
  const day = todayOf(ctx);
  const routine = await mutate(ctx, async () => {
    const id = ctx.newId();
    const ruleId = ctx.newId();
    const saved = await writeEntity(ctx, 'routines', {
      id,
      title: draft.title,
      partOfDay: draft.partOfDay,
      startTime: draft.startTime,
      steps: stepsOf(ctx, draft),
      categoryId: null,
      active: true,
      recurrenceRuleId: ruleId,
    });
    await writeEntity(ctx, 'recurrenceRules', {
      id: ruleId,
      seriesType: 'routine',
      seriesId: id,
      ...draft.repeat,
      startDate: day,
    });
    if (draft.reminder) await saveItemReminder(ctx, 'routine', id, draft.reminder, !!draft.startTime);
    return saved;
  });
  await ensureOccurrences(ctx.db, ctx.ownerId, defaultWindow(day), { seriesId: routine.id });
  return routine;
}

/**
 * Saves the routine form. A changed schedule regenerates the days from today on; days that hold a run (or ticked
 * steps) are kept as they are, so the record of past runs never changes.
 */
export async function updateRoutine(ctx: DataContext, routineId: string, input: RoutineDraft): Promise<Routine> {
  const draft = routineDraftSchema.parse(input);
  const day = todayOf(ctx);
  let regenerate = false;
  const routine = await mutate(ctx, async () => {
    const current = await getEntity(ctx.db, 'routines', routineId, ctx.ownerId);
    if (!current) throw new Error('Routine not found');
    const rule = current.recurrenceRuleId
      ? await getEntity(ctx.db, 'recurrenceRules', current.recurrenceRuleId, ctx.ownerId)
      : null;
    const ruleId = rule?.id ?? ctx.newId();
    const saved = await writeEntity(ctx, 'routines', {
      ...current,
      title: draft.title,
      partOfDay: draft.partOfDay,
      startTime: draft.startTime,
      steps: stepsOf(ctx, draft),
      active: true,
      recurrenceRuleId: ruleId,
    });
    const nextCore: RuleCore = { ...draft.repeat, startDate: rule?.startDate ?? day };
    if (!rule || !sameSchedule(rule, nextCore)) {
      await writeEntity(ctx, 'recurrenceRules', {
        ...(rule ?? { id: ruleId, seriesType: 'routine' as const, seriesId: routineId }),
        ...nextCore,
      });
      await resetGenerated(ctx.db, routineId, day);
      regenerate = true;
    }
    if (draft.reminder !== undefined) {
      await saveItemReminder(ctx, 'routine', routineId, draft.reminder, !!draft.startTime);
    }
    return saved;
  });
  if (regenerate) await ensureOccurrences(ctx.db, ctx.ownerId, defaultWindow(day), { seriesId: routineId });
  return routine;
}

/** Deletes a routine with its rule, reminder and the days from today on (tombstones). Past runs stay stored. */
export async function deleteRoutine(ctx: DataContext, routineId: string): Promise<void> {
  const day = todayOf(ctx);
  await mutate(ctx, async () => {
    const routine = await getEntity(ctx.db, 'routines', routineId, ctx.ownerId);
    if (!routine) return;
    const future = await listEntities(
      ctx.db,
      'occurrences',
      ctx.ownerId,
      'series_id = ? AND is_exception = 1 AND original_date >= ?',
      [routineId, day],
    );
    for (const o of future) await tombstone(ctx, 'occurrences', o.id);
    await removeItemReminders(ctx, 'routine', routineId);
    if (routine.recurrenceRuleId) await tombstone(ctx, 'recurrenceRules', routine.recurrenceRuleId);
    await resetGenerated(ctx.db, routineId, '0000-01-01');
    await tombstone(ctx, 'routines', routineId);
  });
}

export interface RoutineRunRecord {
  /** Ids of the steps that were done (skipped and unreached steps are left out). */
  completedStepIds: readonly string[];
}

/**
 * Records a run on the routine's occurrence of `date` (today). The day counts as done when at least one step was
 * done; a run with nothing done leaves the day open. Running on a day the routine is not planned for creates that
 * day's occurrence, so an extra run is kept too. A second run on the same day replaces the first.
 */
export async function recordRoutineRun(
  ctx: DataContext,
  routineId: string,
  date: LocalDate,
  run: RoutineRunRecord,
): Promise<Occurrence> {
  return mutate(ctx, async () => {
    const routine = await getEntity(ctx.db, 'routines', routineId, ctx.ownerId);
    if (!routine || !routine.recurrenceRuleId) throw new Error('Routine not found');
    const known = new Set(routine.steps.map((s) => s.id));
    const completedStepIds = [...new Set(run.completedStepIds)].filter((id) => known.has(id));
    const done = completedStepIds.length > 0;
    const id = occurrenceId(routineId, date);
    const stored = await getEntity(ctx.db, 'occurrences', id, ctx.ownerId, { includeDeleted: true });
    return writeEntity(ctx, 'occurrences', {
      ...(stored ?? {
        id,
        seriesType: 'routine' as const,
        seriesId: routineId,
        ruleId: routine.recurrenceRuleId,
        originalDate: date,
        date,
        startTime: null,
        durationMin: null,
        title: null,
        notes: null,
      }),
      status: done ? 'done' : 'scheduled',
      completedAt: done ? nowIso(ctx) : null,
      completedStepIds,
      isException: true,
    });
  });
}

export interface RoutineToday {
  occurrenceId: string;
  /** The routine is planned for today (false: it can still be run as an extra). */
  scheduled: boolean;
  done: boolean;
  completedStepIds: string[];
}

export interface RoutineSummary {
  id: string;
  title: string;
  partOfDay: PartOfDay;
  startTime: string | null;
  stepCount: number;
  /** Sum of the planned step minutes (steps without a duration count as 0). */
  totalMin: number;
  rule: RecurrenceRule | null;
  today: RoutineToday;
}

interface OccState {
  id: string;
  series_id: string;
  status: string;
  completed_step_ids: string;
}

function stepIds(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function todayState(routine: Routine, today: LocalDate, row: OccState | undefined): RoutineToday {
  const known = new Set(routine.steps.map((s) => s.id));
  return {
    occurrenceId: row?.id ?? occurrenceId(routine.id, today),
    scheduled: !!row && row.status !== 'skipped',
    done: row?.status === 'done',
    completedStepIds: row ? stepIds(row.completed_step_ids).filter((id) => known.has(id)) : [],
  };
}

const totalMinutes = (routine: Routine) => routine.steps.reduce((sum, s) => sum + (s.durationMin ?? 0), 0);

const PART_ORDER: Record<PartOfDay, number> = { morning: 0, afternoon: 1, evening: 2, anytime: 3 };

/** Routines of the owner, in part-of-day then start-time order, each with its state for today. */
export async function getRoutineList(db: SqlDriver, ownerId: string, today: LocalDate): Promise<RoutineSummary[]> {
  await ensureOccurrences(db, ownerId, defaultWindow(today));
  const routines = await listEntities(db, 'routines', ownerId, 'active = 1');
  if (routines.length === 0) return [];
  const rules = new Map(
    (await listEntities(db, 'recurrenceRules', ownerId, "series_type = 'routine'")).map((r) => [r.seriesId, r]),
  );
  const occs = await db.all<OccState>(
    `SELECT id, series_id, status, completed_step_ids FROM task_occurrences
     WHERE owner_id = ? AND deleted = 0 AND series_type = 'routine' AND date = ?`,
    [ownerId, today],
  );
  const byRoutine = new Map(occs.map((o) => [o.series_id, o]));
  return routines
    .map((r) => ({
      id: r.id,
      title: r.title,
      partOfDay: r.partOfDay,
      startTime: r.startTime,
      stepCount: r.steps.length,
      totalMin: totalMinutes(r),
      rule: rules.get(r.id) ?? null,
      today: todayState(r, today, byRoutine.get(r.id)),
    }))
    .sort(
      (a, b) =>
        PART_ORDER[a.partOfDay] - PART_ORDER[b.partOfDay] ||
        (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') ||
        a.title.localeCompare(b.title),
    );
}

export interface RoutineRun {
  date: LocalDate;
  done: number;
  total: number;
}

export interface RoutineDetail {
  routine: Routine;
  rule: RecurrenceRule | null;
  reminder: ItemReminder | null;
  totalMin: number;
  today: RoutineToday;
  /** Latest recorded runs, newest first. */
  runs: RoutineRun[];
}

export const RECENT_RUNS = 7;

export async function getRoutineDetail(
  db: SqlDriver,
  ownerId: string,
  routineId: string,
  today: LocalDate,
): Promise<RoutineDetail | null> {
  const routine = await getEntity(db, 'routines', routineId, ownerId);
  if (!routine) return null;
  await ensureOccurrences(db, ownerId, defaultWindow(today), { seriesId: routineId });
  const rule = routine.recurrenceRuleId
    ? await getEntity(db, 'recurrenceRules', routine.recurrenceRuleId, ownerId)
    : null;
  const row = await db.first<OccState>(
    `SELECT id, series_id, status, completed_step_ids FROM task_occurrences
     WHERE owner_id = ? AND deleted = 0 AND series_id = ? AND date = ?`,
    [ownerId, routineId, today],
  );
  const past = await db.all<{ date: string; completed_step_ids: string }>(
    `SELECT date, completed_step_ids FROM task_occurrences
     WHERE owner_id = ? AND deleted = 0 AND series_id = ? AND status = 'done'
     ORDER BY date DESC LIMIT ?`,
    [ownerId, routineId, RECENT_RUNS],
  );
  const known = new Set(routine.steps.map((s) => s.id));
  return {
    routine,
    rule,
    reminder: await getItemReminder(db, ownerId, 'routine', routineId),
    totalMin: totalMinutes(routine),
    today: todayState(routine, today, row ?? undefined),
    runs: past.map((p) => ({
      date: p.date,
      // Steps removed since the run no longer count; a run never shows more than the routine has.
      done: Math.min(routine.steps.length, stepIds(p.completed_step_ids).filter((id) => known.has(id)).length),
      total: routine.steps.length,
    })),
  };
}

const repeatOf = (rule: RecurrenceRule): RepeatDraft => ({
  freq: rule.freq,
  interval: rule.interval,
  byWeekday: rule.byWeekday,
  byMonthDay: rule.byMonthDay,
  weekStartsOn: rule.weekStartsOn,
  endType: rule.endType,
  endDate: rule.endDate,
  count: rule.count,
});

export interface RoutineForm {
  routine: Routine;
  rule: RecurrenceRule | null;
  draft: RoutineDraft;
}

export async function loadRoutineForm(
  ctx: Pick<DataContext, 'db' | 'ownerId'>,
  routineId: string,
  weekStartsOn: 0 | 1 | 6,
): Promise<RoutineForm | null> {
  const routine = await getEntity(ctx.db, 'routines', routineId, ctx.ownerId);
  if (!routine) return null;
  const rule = routine.recurrenceRuleId
    ? await getEntity(ctx.db, 'recurrenceRules', routine.recurrenceRuleId, ctx.ownerId)
    : null;
  return {
    routine,
    rule,
    draft: {
      title: routine.title,
      partOfDay: routine.partOfDay,
      startTime: routine.startTime,
      steps: routine.steps.map((s) => ({ id: s.id, title: s.title, durationMin: s.durationMin ?? null })),
      repeat: rule ? repeatOf(rule) : emptyRoutineDraft(weekStartsOn).repeat,
      reminder: await getItemReminder(ctx.db, ctx.ownerId, 'routine', routineId),
    },
  };
}
