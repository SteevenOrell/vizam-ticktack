/**
 * Task use cases on top of the generic write path: create, edit (one task, or one / following / all occurrences of
 * a series), complete, delete. Every write runs in one transaction through `writeEntity` (validation + outbox).
 */
import { z } from 'zod';

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
import { defaultWindow, ensureOccurrences, resetGenerated } from './occurrences';
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
    date: localDateSchema.nullable(),
    startTime: hhmmSchema.nullable(),
    durationMin: z.number().int().min(1).max(1440).nullable(),
    repeat: repeatDraftSchema.nullable(),
    subtasks: z.array(subtaskDraftSchema).max(30),
  })
  .superRefine((d, ctx) => {
    if (d.repeat && !d.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'dateRequiredForRepeat' });
    if (d.startTime && !d.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'dateRequiredForTime' });
    if (d.repeat?.endType === 'onDate' && d.date && d.repeat.endDate && d.repeat.endDate < d.date) {
      ctx.addIssue({ code: 'custom', path: ['repeat', 'endDate'], message: 'endBeforeStart' });
    }
  });
export type TaskDraft = z.infer<typeof taskDraftSchema>;

export const emptyDraft = (date: LocalDate | null): TaskDraft => ({
  title: '',
  notes: null,
  priority: 0,
  categoryId: null,
  date,
  startTime: null,
  durationMin: null,
  repeat: null,
  subtasks: [],
});

const today = (ctx: DataContext) => localDateOf(ctx.now?.() ?? new Date());

function taskFields(draft: TaskDraft) {
  return {
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

/** Creates a one-off task, or a recurring series (template task + rule) whose occurrences are generated. */
export async function createTask(ctx: DataContext, input: TaskDraft): Promise<Task> {
  const draft = taskDraftSchema.parse(input);
  const id = ctx.newId();
  const ruleId = draft.repeat ? ctx.newId() : null;
  const task = await mutate(ctx, async () => {
    const t = await writeEntity(ctx, 'tasks', {
      id,
      ...taskFields(draft),
      status: 'open',
      goalId: null,
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
    return t;
  });
  if (ruleId) await ensureOccurrences(ctx.db, ctx.ownerId, defaultWindow(today(ctx)), { seriesId: id });
  return task;
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
  const draft = taskDraftSchema.parse(input);
  const task = await getEntity(ctx.db, 'tasks', taskId, ctx.ownerId);
  if (!task) throw new Error('Task not found');
  const rule = task.recurrenceRuleId
    ? await getEntity(ctx.db, 'recurrenceRules', task.recurrenceRuleId, ctx.ownerId)
    : null;
  const day = today(ctx);
  const regenerate: string[] = [];

  await mutate(ctx, async () => {
    // One-off task (possibly turning into a series).
    if (!rule) {
      const ruleId = draft.repeat ? ctx.newId() : null;
      const t = await writeEntity(ctx, 'tasks', { ...task, ...taskFields(draft), recurrenceRuleId: ruleId });
      if (draft.repeat && draft.date && ruleId) {
        await writeRule(ctx, task.id, { ...draft.repeat, startDate: draft.date }, ruleId);
        regenerate.push(task.id);
      }
      await syncSubtasks(ctx, t, draft.subtasks);
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
      if (draft.repeat && newRuleId) {
        await writeRule(ctx, newId, { ...draft.repeat, startDate: start }, newRuleId);
        regenerate.push(newId);
      }
      await syncSubtasks(
        ctx,
        t,
        draft.subtasks.map((s) => ({ title: s.title, done: false })),
      );
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
      return;
    }

    const nextCore: RuleCore = { ...draft.repeat, startDate: rule.startDate };
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
