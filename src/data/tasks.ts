/**
 * Task use cases on top of the generic write path: create, edit (one task, or one / following / all occurrences of
 * a series), complete, delete. Every write runs in one transaction through `writeEntity` (validation + outbox).
 */
import { z } from 'zod';

import { clampRuleToGoal, goalRepeatIssue } from '../domain/goals';
import { addDays, localDateOf, type LocalDate } from '../domain/localDate';
import {
  hhmmSchema,
  localDateSchema,
  ruleCoreSchema,
  type Occurrence,
  type RecurrenceRule,
  type RuleCore,
  type Task,
} from '../domain/models';
import { occurrenceId, parseOccurrenceId, producesDate } from '../domain/recurrence/generator';
import { orphanedExceptions, sameSchedule, splitRule, type EditScope } from '../domain/recurrence/seriesEdit';
import { CATEGORY_NAME_MAX, normalizeCategoryName } from '../domain/categoryName';
import { resolveCategoryName } from './categories';
import { GoalRepeatError, goalRepeatLimit, insertGoal } from './goalBase';
import { defaultWindow, ensureOccurrences, resetGenerated } from './occurrences';
import { copyItemReminder, getItemReminder, itemReminderSchema, saveItemReminder } from './reminders';
import { getEntity, listEntities, mutate, nowIso, tombstone, writeEntity, type DataContext } from './store';

/** What the editor submits. The repeat part has no start date: the task's date is the series start. */
export const repeatDraftSchema = ruleCoreSchema.omit({ startDate: true }).superRefine((r, ctx) => {
  if (r.endType === 'onDate' && !r.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'required' });
  if (r.endType === 'afterCount' && !r.count) ctx.addIssue({ code: 'custom', path: ['count'], message: 'required' });
  if (r.freq === 'weekly' && (!r.byWeekday || r.byWeekday.length === 0)) {
    ctx.addIssue({ code: 'custom', path: ['byWeekday'], message: 'required' });
  }
});
export type RepeatDraft = z.infer<typeof repeatDraftSchema>;

export const subtaskDraftSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  title: z.string().trim().min(1).max(200),
  done: z.boolean(),
});

export const taskDraftSchema = z
  .object({
    title: z.string().trim().min(1, 'titleRequired').max(200, 'titleTooLong'),
    notes: z.string().max(5000, 'notesTooLong').nullable(),
    priority: z.number().int().min(0).max(3),
    categoryId: z.string().min(1).nullable(),
    /** Free-text category from the editor. When present it wins over `categoryId` (found or created on save). */
    categoryName: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .refine((v) => (normalizeCategoryName(v)?.length ?? 0) <= CATEGORY_NAME_MAX, 'categoryTooLong'),
    /** Linked goal; undefined keeps the stored link on update. */
    goalId: z.string().min(1).max(128).nullable().optional(),
    /** A new goal to create on save and link to this task ("New goal" in the editor); wins over `goalId`. */
    newGoalTitle: z.string().trim().min(1).max(120, 'goalTooLong').nullable().optional(),
    date: localDateSchema.nullable(),
    startTime: hhmmSchema.nullable(),
    durationMin: z.number().int().min(1).max(1440).nullable(),
    repeat: repeatDraftSchema.nullable(),
    subtasks: z.array(subtaskDraftSchema).max(30),
    /** Reminder of the task or series; null = none, undefined keeps the stored one. */
    reminder: itemReminderSchema.nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.repeat && !d.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'dateRequiredForRepeat' });
    if (d.startTime && !d.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'dateRequiredForTime' });
    if (d.repeat?.endType === 'onDate' && d.date && d.repeat.endDate && d.repeat.endDate < d.date) {
      ctx.addIssue({ code: 'custom', path: ['repeat', 'endDate'], message: 'endBeforeStart' });
    }
    // A repeating task linked to a goal must end (the end is checked against the goal's limit on save).
    if (d.repeat?.endType === 'never' && (d.goalId || d.newGoalTitle)) {
      ctx.addIssue({ code: 'custom', path: ['repeat', 'endType'], message: 'repeatNeverInGoal' });
    }
  });
export type TaskDraft = z.infer<typeof taskDraftSchema>;

export const emptyDraft = (date: LocalDate | null): TaskDraft => ({
  title: '',
  notes: null,
  priority: 0,
  categoryId: null,
  categoryName: null,
  goalId: null,
  date,
  startTime: null,
  durationMin: null,
  repeat: null,
  subtasks: [],
});

const today = (ctx: DataContext) => localDateOf(ctx.now?.() ?? new Date());

function taskFields(draft: TaskDraft) {
  return {
    ...(draft.goalId !== undefined ? { goalId: draft.goalId } : {}),
    title: draft.title.trim(),
    notes: draft.notes?.trim() ? draft.notes : null,
    priority: draft.priority,
    categoryId: draft.categoryId,
    date: draft.date,
    startTime: draft.date ? draft.startTime : null,
    durationMin: draft.durationMin,
  };
}

async function writeRule(
  ctx: DataContext,
  seriesId: string,
  core: RuleCore,
  id: string = ctx.newId(),
): Promise<RecurrenceRule> {
  return writeEntity(ctx, 'recurrenceRules', { id, seriesType: 'task', seriesId, ...core });
}

/**
 * Refuses a rule that never ends, or ends after the goal's limit (due date / end of the current period), on a
 * goal-linked task. Must run inside `mutate` so a refused save rolls back.
 */
async function assertGoalRepeat(ctx: DataContext, goalId: string | null | undefined, core: RuleCore): Promise<void> {
  if (!goalId) return;
  const goal = await getEntity(ctx.db, 'goals', goalId, ctx.ownerId);
  if (!goal) return;
  const issue = goalRepeatIssue(core, goalRepeatLimit(goal, today(ctx)));
  if (issue) throw new GoalRepeatError(issue);
}

/**
 * Ends a goal-linked series on the goal's limit when it has no end or runs past it (linking a task to a goal,
 * moving a goal's due date or period, repairing older data). Future occurrences after the new end are dropped.
 * Returns true when the rule changed; the caller then runs `ensureOccurrences` for the series after the
 * transaction. Must run inside `mutate`.
 */
export async function clampSeriesToGoal(ctx: DataContext, task: Task, limit: LocalDate | null): Promise<boolean> {
  if (!task.recurrenceRuleId) return false;
  const rule = await getEntity(ctx.db, 'recurrenceRules', task.recurrenceRuleId, ctx.ownerId);
  if (!rule) return false;
  const day = today(ctx);
  const next = clampRuleToGoal(rule, limit, day);
  if (next === rule || !next.endDate) return false;
  await writeEntity(ctx, 'recurrenceRules', next);
  for (const o of orphanedExceptions(next, await exceptionsFrom(ctx, task.id, day), day)) {
    await tombstone(ctx, 'occurrences', o.id);
  }
  await resetGenerated(ctx.db, task.id, addDays(next.endDate, 1));
  return true;
}

/** Saves the draft's reminder for `taskId`; when the draft leaves it alone, a task split off `fromId` inherits it. */
async function applyReminder(ctx: DataContext, draft: TaskDraft, taskId: string, fromId?: string) {
  const timed = !!(draft.date && draft.startTime);
  if (draft.reminder !== undefined) await saveItemReminder(ctx, 'task', taskId, draft.reminder, timed);
  else if (fromId && fromId !== taskId) await copyItemReminder(ctx, 'task', fromId, taskId, timed);
}

async function syncSubtasks(ctx: DataContext, parent: Task, subtasks: TaskDraft['subtasks']) {
  const existing = await listEntities(ctx.db, 'tasks', ctx.ownerId, 'parent_task_id = ?', [parent.id], 'sort_order');
  const keep = new Set(subtasks.map((s) => s.id).filter(Boolean));
  for (const old of existing) if (!keep.has(old.id)) await tombstone(ctx, 'tasks', old.id);
  let order = 0;
  for (const s of subtasks) {
    const prev = s.id ? existing.find((e) => e.id === s.id) : undefined;
    const status = s.done ? 'done' : 'open';
    await writeEntity(ctx, 'tasks', {
      id: prev?.id ?? ctx.newId(),
      title: s.title.trim(),
      notes: null,
      status,
      priority: 0,
      categoryId: null,
      goalId: null,
      milestoneId: null,
      parentTaskId: parent.id,
      date: null,
      startTime: null,
      durationMin: null,
      sortOrder: order,
      completedAt: s.done ? (prev?.completedAt ?? nowIso(ctx)) : null,
      recurrenceRuleId: null,
    });
    order += 1;
  }
}

/**
 * Resolves the free-text category (find or create, in the current transaction) and checks that a linked goal
 * belongs to the owner. Returns the draft with `categoryId` set. Must run inside `mutate`.
 */
async function resolveRefs(ctx: DataContext, draft: TaskDraft): Promise<TaskDraft> {
  let next = draft;
  if (draft.categoryName !== undefined) {
    next = { ...next, categoryId: await resolveCategoryName(ctx, draft.categoryName) };
  }
  if (draft.newGoalTitle) {
    // Created in the same transaction as the task, so the goal is never left without a task.
    const goal = await insertGoal(ctx, { title: draft.newGoalTitle });
    return { ...next, goalId: goal.id, newGoalTitle: null };
  }
  if (draft.goalId && !(await getEntity(ctx.db, 'goals', draft.goalId, ctx.ownerId))) {
    throw new Error('Goal not found');
  }
  return next;
}

/** Creates a one-off task, or a recurring series (template task + rule) whose occurrences are generated. */
export async function createTask(ctx: DataContext, input: TaskDraft): Promise<Task> {
  const parsed = taskDraftSchema.parse(input);
  const task = await mutate(ctx, () => insertTask(ctx, parsed));
  if (task.recurrenceRuleId) {
    await ensureOccurrences(ctx.db, ctx.ownerId, defaultWindow(today(ctx)), { seriesId: task.id });
  }
  return task;
}

/**
 * Writes a new task (with its rule and subtasks) inside the caller's `mutate` transaction. Callers that create a
 * series run `ensureOccurrences` for it after the transaction.
 */
export async function insertTask(ctx: DataContext, parsed: TaskDraft): Promise<Task> {
  const id = ctx.newId();
  const ruleId = parsed.repeat ? ctx.newId() : null;
  const draft = await resolveRefs(ctx, parsed);
  if (draft.repeat && draft.date) await assertGoalRepeat(ctx, draft.goalId, { ...draft.repeat, startDate: draft.date });
  const t = await writeEntity(ctx, 'tasks', {
    id,
    goalId: null,
    ...taskFields(draft),
    status: 'open',
    milestoneId: null,
    parentTaskId: null,
    sortOrder: 0,
    completedAt: null,
    recurrenceRuleId: ruleId,
  });
  if (draft.repeat && draft.date && ruleId) {
    await writeRule(ctx, id, { ...draft.repeat, startDate: draft.date }, ruleId);
  }
  await syncSubtasks(ctx, t, draft.subtasks);
  await applyReminder(ctx, draft, id);
  return t;
}

export interface TaskForm {
  task: Task;
  rule: RecurrenceRule | null;
  occurrence: Occurrence | null;
  draft: TaskDraft;
}

/** Loads a task (or one occurrence of a series) into an editor draft. Null when missing or not owned. */
export async function loadTaskForm(
  ctx: Pick<DataContext, 'db' | 'ownerId'>,
  taskId: string,
  occId?: string | null,
): Promise<TaskForm | null> {
  const task = await getEntity(ctx.db, 'tasks', taskId, ctx.ownerId);
  if (!task) return null;
  const rule = task.recurrenceRuleId
    ? await getEntity(ctx.db, 'recurrenceRules', task.recurrenceRuleId, ctx.ownerId)
    : null;
  const occurrence = occId ? await getEntity(ctx.db, 'occurrences', occId, ctx.ownerId) : null;
  const subtasks = await listEntities(ctx.db, 'tasks', ctx.ownerId, 'parent_task_id = ?', [task.id], 'sort_order');
  const ticked = new Set(occurrence?.completedStepIds ?? []);
  const draft: TaskDraft = {
    title: occurrence?.title ?? task.title,
    notes: occurrence?.notes ?? task.notes,
    priority: task.priority,
    categoryId: task.categoryId,
    categoryName: task.categoryId
      ? ((await getEntity(ctx.db, 'categories', task.categoryId, ctx.ownerId))?.name ?? null)
      : null,
    goalId: task.goalId,
    date: occurrence?.date ?? (rule ? rule.startDate : task.date),
    startTime: occurrence?.startTime ?? task.startTime,
    durationMin: occurrence?.durationMin ?? task.durationMin,
    repeat: rule
      ? {
          freq: rule.freq,
          interval: rule.interval,
          byWeekday: rule.byWeekday,
          byMonthDay: rule.byMonthDay,
          weekStartsOn: rule.weekStartsOn,
          endType: rule.endType,
          endDate: rule.endDate,
          count: rule.count,
        }
      : null,
    subtasks: subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      done: occurrence ? ticked.has(s.id) : s.status === 'done',
    })),
    reminder: await getItemReminder(ctx.db, ctx.ownerId, 'task', task.id),
  };
  return { task, rule, occurrence, draft };
}

/** Returns the stored occurrence, or builds the generated one (series outside the materialised window). */
async function occurrenceFor(ctx: DataContext, occId: string): Promise<Occurrence> {
  const stored = await getEntity(ctx.db, 'occurrences', occId, ctx.ownerId, { includeDeleted: true });
  if (stored) return stored;
  const parsed = parseOccurrenceId(occId);
  if (!parsed) throw new Error('Invalid occurrence id');
  const series = await getEntity(ctx.db, 'tasks', parsed.seriesId, ctx.ownerId);
  const rule = series?.recurrenceRuleId
    ? await getEntity(ctx.db, 'recurrenceRules', series.recurrenceRuleId, ctx.ownerId)
    : null;
  if (!series || !rule || !producesDate(rule, parsed.originalDate)) throw new Error('Unknown occurrence');
  const now = nowIso(ctx);
  return {
    id: occId,
    ownerId: ctx.ownerId,
    createdAt: now,
    clientUpdatedAt: now,
    serverUpdatedAt: null,
    deleted: false,
    schemaVersion: 1,
    seriesType: 'task',
    seriesId: series.id,
    ruleId: rule.id,
    originalDate: parsed.originalDate,
    date: parsed.originalDate,
    startTime: null,
    durationMin: null,
    title: null,
    notes: null,
    status: 'scheduled',
    completedAt: null,
    completedStepIds: [],
    isException: false,
  };
}

/** Writes an occurrence as an exception (synced). */
async function writeException(ctx: DataContext, occ: Occurrence, changes: Partial<Occurrence>) {
  const { ownerId: _o, clientUpdatedAt: _c, serverUpdatedAt: _s, schemaVersion: _v, ...rest } = occ;
  return writeEntity(ctx, 'occurrences', { ...rest, ...changes, isException: true });
}

/** Future exceptions of a series (original date on or after `from`). */
async function exceptionsFrom(ctx: DataContext, seriesId: string, from: LocalDate) {
  return listEntities(ctx.db, 'occurrences', ctx.ownerId, 'series_id = ? AND is_exception = 1 AND original_date >= ?', [
    seriesId,
    from,
  ]);
}

/** Exceptions a series edit would remove (shown in the confirmation before saving "all"). */
export async function previewOrphans(
  ctx: DataContext,
  taskId: string,
  repeat: RepeatDraft,
): Promise<{ originalDate: LocalDate }[]> {
  const task = await getEntity(ctx.db, 'tasks', taskId, ctx.ownerId);
  const rule = task?.recurrenceRuleId
    ? await getEntity(ctx.db, 'recurrenceRules', task.recurrenceRuleId, ctx.ownerId)
    : null;
  if (!rule) return [];
  const next: RuleCore = { ...repeat, startDate: rule.startDate };
  return orphanedExceptions(next, await exceptionsFrom(ctx, taskId, today(ctx)), today(ctx));
}

export interface UpdateOptions {
  /** For a series: which occurrences the edit applies to. Ignored for one-off tasks. */
  scope?: EditScope;
  /** The occurrence being edited (`seriesId_YYYYMMDD`), required for scope `this` and `following`. */
  occurrenceId?: string | null;
}

export async function updateTask(
  ctx: DataContext,
  taskId: string,
  input: TaskDraft,
  options: UpdateOptions = {},
): Promise<void> {
  const parsed = taskDraftSchema.parse(input);
  const task = await getEntity(ctx.db, 'tasks', taskId, ctx.ownerId);
  if (!task) throw new Error('Task not found');
  const rule = task.recurrenceRuleId
    ? await getEntity(ctx.db, 'recurrenceRules', task.recurrenceRuleId, ctx.ownerId)
    : null;
  const day = today(ctx);
  const regenerate: string[] = [];

  await mutate(ctx, async () => {
    const draft = await resolveRefs(ctx, parsed);
    const goalId = draft.goalId !== undefined ? draft.goalId : task.goalId;
    // One-off task (possibly turning into a series).
    if (!rule) {
      const ruleId = draft.repeat ? ctx.newId() : null;
      if (draft.repeat && draft.date) await assertGoalRepeat(ctx, goalId, { ...draft.repeat, startDate: draft.date });
      const t = await writeEntity(ctx, 'tasks', { ...task, ...taskFields(draft), recurrenceRuleId: ruleId });
      if (draft.repeat && draft.date && ruleId) {
        await writeRule(ctx, task.id, { ...draft.repeat, startDate: draft.date }, ruleId);
        regenerate.push(task.id);
      }
      await syncSubtasks(ctx, t, draft.subtasks);
      await applyReminder(ctx, draft, task.id);
      return;
    }

    const scope = options.scope ?? 'all';
    const occ = options.occurrenceId ? await occurrenceFor(ctx, options.occurrenceId) : null;
    if ((scope === 'this' || scope === 'following') && !occ) throw new Error('Occurrence required for this scope');

    if (scope === 'this' && occ) {
      // Overrides only where the occurrence differs from its series.
      await writeException(ctx, occ, {
        title: draft.title.trim() === task.title ? null : draft.title.trim(),
        notes: (draft.notes ?? null) === task.notes ? null : draft.notes,
        date: draft.date ?? occ.date,
        startTime: draft.startTime === task.startTime ? null : draft.startTime,
        durationMin: draft.durationMin === task.durationMin ? null : draft.durationMin,
        completedStepIds: draft.subtasks.filter((s) => s.done && s.id).map((s) => s.id as string),
      });
      return;
    }

    // A split with nothing before it is the same as editing the whole series.
    const split = scope === 'following' && occ ? splitRule(rule, occ.originalDate) : null;
    if (split?.before && occ) {
      // The new series starts later than the old one, so an "after n times" end can now pass the goal's limit:
      // it is ended on the limit instead of refusing the edit.
      const followingGoal = goalId ? await getEntity(ctx.db, 'goals', goalId, ctx.ownerId) : null;
      const repeat =
        draft.repeat && followingGoal
          ? clampRuleToGoal(
              { ...draft.repeat, startDate: draft.date ?? occ.originalDate },
              goalRepeatLimit(followingGoal, day),
              day,
            )
          : draft.repeat;
      // End the old series the day before; forget its future occurrences.
      await writeEntity(ctx, 'recurrenceRules', { ...rule, ...split.before });
      for (const e of await exceptionsFrom(ctx, task.id, occ.originalDate)) await tombstone(ctx, 'occurrences', e.id);
      await resetGenerated(ctx.db, task.id, occ.originalDate);
      regenerate.push(task.id);
      // The new series starts on the edited occurrence's date (or where the user moved it).
      const newId = ctx.newId();
      const newRuleId = draft.repeat ? ctx.newId() : null;
      const start = draft.date ?? occ.originalDate;
      const t = await writeEntity(ctx, 'tasks', {
        ...task,
        id: newId,
        ...taskFields({ ...draft, date: start }),
        createdAt: undefined,
        recurrenceRuleId: newRuleId,
        status: 'open',
        completedAt: null,
      });
      if (repeat && newRuleId) {
        await writeRule(ctx, newId, { ...repeat, startDate: start }, newRuleId);
        regenerate.push(newId);
      }
      await syncSubtasks(
        ctx,
        t,
        draft.subtasks.map((s) => ({ title: s.title, done: false })),
      );
      await applyReminder(ctx, { ...draft, date: start }, newId, task.id);
      return;
    }

    // scope "all" (or "following" from the first occurrence).
    if (!draft.repeat) {
      // Stop repeating from today; keep the edited item as a one-off task on its date.
      await writeEntity(ctx, 'recurrenceRules', { ...rule, endType: 'onDate', endDate: addDays(day, -1), count: null });
      await resetGenerated(ctx.db, task.id, day);
      for (const e of await exceptionsFrom(ctx, task.id, day)) await tombstone(ctx, 'occurrences', e.id);
      const t = await writeEntity(ctx, 'tasks', {
        ...task,
        id: ctx.newId(),
        ...taskFields(draft),
        createdAt: undefined,
        recurrenceRuleId: null,
        status: 'open',
        completedAt: null,
      });
      await syncSubtasks(
        ctx,
        t,
        draft.subtasks.map((s) => ({ title: s.title, done: s.done })),
      );
      await applyReminder(ctx, draft, t.id, task.id);
      return;
    }

    const nextCore: RuleCore = { ...draft.repeat, startDate: rule.startDate };
    // Checked even when the schedule is unchanged: the goal link itself may be new.
    await assertGoalRepeat(ctx, goalId, nextCore);
    await writeEntity(ctx, 'tasks', { ...task, ...taskFields({ ...draft, date: rule.startDate }) });
    if (!sameSchedule(rule, nextCore)) {
      await writeEntity(ctx, 'recurrenceRules', { ...rule, ...nextCore });
      const orphans = orphanedExceptions(nextCore, await exceptionsFrom(ctx, task.id, day), day);
      for (const o of orphans) await tombstone(ctx, 'occurrences', o.id);
      await resetGenerated(ctx.db, task.id, day);
      regenerate.push(task.id);
    }
    await syncSubtasks(
      ctx,
      task,
      draft.subtasks.map((s) => ({ id: s.id, title: s.title, done: false })),
    );
    await applyReminder(ctx, { ...draft, date: rule.startDate }, task.id);
  });

  for (const seriesId of regenerate) {
    await ensureOccurrences(ctx.db, ctx.ownerId, defaultWindow(day), { seriesId });
  }
}

export interface ItemRef {
  taskId: string;
  occurrenceId?: string | null;
}

/** Checks or unchecks a task or one occurrence. */
export async function setDone(ctx: DataContext, ref: ItemRef, done: boolean): Promise<void> {
  await mutate(ctx, async () => {
    if (ref.occurrenceId) {
      const occ = await occurrenceFor(ctx, ref.occurrenceId);
      await writeException(ctx, occ, {
        status: done ? 'done' : 'scheduled',
        completedAt: done ? nowIso(ctx) : null,
      });
      return;
    }
    const task = await getEntity(ctx.db, 'tasks', ref.taskId, ctx.ownerId);
    if (!task) throw new Error('Task not found');
    await writeEntity(ctx, 'tasks', {
      ...task,
      status: done ? 'done' : 'open',
      completedAt: done ? nowIso(ctx) : null,
    });
  });
}

/** Ticks a subtask: on a one-off task the subtask itself, on an occurrence its `completedStepIds`. */
export async function setSubtaskDone(ctx: DataContext, ref: ItemRef, subtaskId: string, done: boolean) {
  await mutate(ctx, async () => {
    if (ref.occurrenceId) {
      const occ = await occurrenceFor(ctx, ref.occurrenceId);
      const ids = new Set(occ.completedStepIds);
      if (done) ids.add(subtaskId);
      else ids.delete(subtaskId);
      await writeException(ctx, occ, { completedStepIds: [...ids] });
      return;
    }
    const sub = await getEntity(ctx.db, 'tasks', subtaskId, ctx.ownerId);
    if (!sub || sub.parentTaskId !== ref.taskId) throw new Error('Subtask not found');
    await writeEntity(ctx, 'tasks', { ...sub, status: done ? 'done' : 'open', completedAt: done ? nowIso(ctx) : null });
  });
}

/** Moves a one-off task or one occurrence to another day (reschedule). */
export async function moveToDate(ctx: DataContext, ref: ItemRef, date: LocalDate): Promise<void> {
  localDateSchema.parse(date);
  await mutate(ctx, async () => {
    if (ref.occurrenceId) {
      await writeException(ctx, await occurrenceFor(ctx, ref.occurrenceId), { date });
      return;
    }
    const task = await getEntity(ctx.db, 'tasks', ref.taskId, ctx.ownerId);
    if (!task || task.recurrenceRuleId) throw new Error('Task not found');
    await writeEntity(ctx, 'tasks', { ...task, date });
  });
}

/**
 * Moves a task to another start time (drag in the calendar). A one-off task is simply updated. For a series the
 * scope decides: `this` writes an exception for the occurrence, `following` splits the series at the occurrence,
 * `all` changes the series template. Runs through `updateTask`, so validation, the outbox and the goal-repeat rule
 * (`GoalRepeatError`) apply as for any other edit; the repeat settings themselves are never changed here.
 */
export async function rescheduleTime(
  ctx: DataContext,
  ref: ItemRef,
  startTime: string,
  scope: EditScope = 'all',
): Promise<void> {
  hhmmSchema.parse(startTime);
  const occId = ref.occurrenceId ?? null;
  // "This occurrence" starts from the occurrence's own values; the series scopes start from the template, so an
  // override on the dragged occurrence (a renamed day, say) is not copied to the whole series.
  const form = await loadTaskForm(ctx, ref.taskId, scope === 'this' ? occId : null);
  if (!form) throw new Error('Task not found');
  // The goal link is left as stored (`undefined`): the repository then checks the series against its goal and
  // refuses with `GoalRepeatError`, and a "this occurrence" move, which does not touch the rule, is not checked.
  const base: TaskDraft = { ...form.draft, goalId: undefined, startTime };
  if (!form.rule) {
    if (!form.draft.date) throw new Error('Task has no date');
    await updateTask(ctx, ref.taskId, base);
    return;
  }
  if (!occId) throw new Error('Occurrence required to move a repeating task');
  const occ = await occurrenceFor(ctx, occId);
  const draft = scope === 'following' ? { ...base, date: occ.date } : base;
  await updateTask(ctx, ref.taskId, draft, { scope, occurrenceId: occId });
  // "All": the dragged occurrence follows the series again, otherwise its own start time would keep it in place.
  if (scope === 'all' && occ.startTime !== null && occ.startTime !== startTime) {
    await mutate(ctx, async () => {
      const stored = await getEntity(ctx.db, 'occurrences', occId, ctx.ownerId);
      if (stored) await writeException(ctx, stored, { startTime: null });
    });
  }
}

/** Deletes a task, or one / following / all occurrences of a series (tombstones; never hard deletes). */
export async function deleteTask(ctx: DataContext, ref: ItemRef, scope: EditScope = 'all'): Promise<void> {
  const task = await getEntity(ctx.db, 'tasks', ref.taskId, ctx.ownerId);
  if (!task) return;
  const rule = task.recurrenceRuleId
    ? await getEntity(ctx.db, 'recurrenceRules', task.recurrenceRuleId, ctx.ownerId)
    : null;
  const day = today(ctx);

  await mutate(ctx, async () => {
    if (rule && scope === 'this' && ref.occurrenceId) {
      const occ = await occurrenceFor(ctx, ref.occurrenceId);
      await writeException(ctx, occ, { status: 'skipped' });
      return;
    }
    if (rule && scope === 'following' && ref.occurrenceId) {
      const occ = await occurrenceFor(ctx, ref.occurrenceId);
      const { before } = splitRule(rule, occ.originalDate);
      if (before) {
        await writeEntity(ctx, 'recurrenceRules', { ...rule, ...before });
        for (const e of await exceptionsFrom(ctx, task.id, occ.originalDate)) {
          await tombstone(ctx, 'occurrences', e.id);
        }
        await resetGenerated(ctx.db, task.id, occ.originalDate);
        return;
      }
      // Splitting at the first occurrence removes the whole series.
    }
    const subtasks = await listEntities(ctx.db, 'tasks', ctx.ownerId, 'parent_task_id = ?', [task.id]);
    for (const s of subtasks) await tombstone(ctx, 'tasks', s.id);
    const reminders = await listEntities(ctx.db, 'reminders', ctx.ownerId, "target_type = 'task' AND target_id = ?", [
      task.id,
    ]);
    for (const r of reminders) await tombstone(ctx, 'reminders', r.id);
    if (rule) {
      for (const e of await exceptionsFrom(ctx, task.id, day)) await tombstone(ctx, 'occurrences', e.id);
      await tombstone(ctx, 'recurrenceRules', rule.id);
      await resetGenerated(ctx.db, task.id, '0000-01-01');
    }
    await tombstone(ctx, 'tasks', task.id);
  });
}

export { occurrenceId };
