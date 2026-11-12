/**
 * Domain models (ARCHITECTURE.md section 3). One Zod schema per synced entity, used for every local write and for
 * every document pulled from Firestore (remote data is untrusted). Pure TypeScript: no React, Expo or SQLite here.
 */
import { z } from 'zod';

import { HHMM_RE, isLocalDate } from '../localDate';

export const LOCAL_OWNER = 'local';
export const SCHEMA_VERSION = 1;

export const localDateSchema = z.string().refine(isLocalDate, 'Expected a YYYY-MM-DD date');
export const hhmmSchema = z.string().regex(HHMM_RE, 'Expected HH:mm');
/**
 * ISO 8601 date-time as `Date.toISOString()` writes it (offsets accepted). Same pattern and length as `isIso` in
 * firebase/firestore.rules, so a value the client accepts is never refused by the server.
 */
export const ISO_DATETIME_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$/;
const isoSchema = z.string().min(10).max(40).regex(ISO_DATETIME_RE, 'Expected an ISO date-time');
/** Client UUIDs, plus deterministic occurrence IDs (`seriesId_YYYYMMDD`) and the profile ID (= uid). */
export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const categoryColorSchema = z.enum(['ember', 'sage', 'sky', 'plum', 'moss', 'sand', 'rose', 'slate']);
export type CategoryColor = z.infer<typeof categoryColorSchema>;
export const categoryIconSchema = z.enum(['target', 'heart', 'home', 'book', 'briefcase', 'star', 'leaf', 'dot']);

/** Shared fields of every synced entity (section 3.1). `serverUpdatedAt` is epoch ms of the last accepted write. */
export const baseSchema = z.object({
  id: idSchema,
  ownerId: z.string().min(1).max(128),
  createdAt: isoSchema,
  clientUpdatedAt: isoSchema,
  serverUpdatedAt: z.number().int().nonnegative().nullable(),
  deleted: z.boolean(),
  schemaVersion: int(1, 99),
});
export type BaseEntity = z.infer<typeof baseSchema>;

export const weekStartSchema = z.union([z.literal(0), z.literal(1), z.literal(6)]);

export const profileSchema = baseSchema.extend({
  displayName: trimmed(1, 60).nullable(),
  timeZone: z.string().min(1).max(64),
  weekStartsOn: weekStartSchema,
  theme: z.enum(['system', 'dark', 'light']),
  dayStart: hhmmSchema.nullable(),
  dayEnd: hhmmSchema.nullable(),
  dailyCapacityMin: int(0, 1440),
  defaultReminderOffsetMin: int(0, 10080),
  onboardingCompletedAt: isoSchema.nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

export const categorySchema = baseSchema.extend({
  // The rules require `^\S(.*\S)?$`, where `.` does not match a line break: names are single-line.
  name: trimmed(1, 40).regex(/^[^\n\r]*$/, 'Single line only'),
  color: categoryColorSchema,
  icon: categoryIconSchema,
  sortOrder: int(0, 10000),
  archived: z.boolean(),
});
export type Category = z.infer<typeof categorySchema>;

export const taskStatusSchema = z.enum(['open', 'done', 'cancelled']);
export const prioritySchema = int(0, 3);

export const taskSchema = baseSchema.extend({
  title: trimmed(1, 200),
  notes: z.string().max(5000).nullable(),
  status: taskStatusSchema,
  priority: prioritySchema,
  categoryId: idSchema.nullable(),
  goalId: idSchema.nullable(),
  milestoneId: idSchema.nullable(),
  parentTaskId: idSchema.nullable(),
  date: localDateSchema.nullable(),
  startTime: hhmmSchema.nullable(),
  durationMin: int(1, 1440).nullable(),
  sortOrder: int(0, 100000),
  completedAt: isoSchema.nullable(),
  recurrenceRuleId: idSchema.nullable(),
});
export type Task = z.infer<typeof taskSchema>;

export const freqSchema = z.enum(['daily', 'weekly', 'monthly']);
export const endTypeSchema = z.enum(['never', 'onDate', 'afterCount']);

/** Fields that describe the repetition itself (shared by the stored rule and the editor draft). */
export const ruleCoreSchema = z.object({
  freq: freqSchema,
  interval: int(1, 99),
  byWeekday: z.array(int(0, 6)).max(7).nullable(),
  byMonthDay: int(1, 31).nullable(),
  weekStartsOn: weekStartSchema,
  startDate: localDateSchema,
  endType: endTypeSchema,
  endDate: localDateSchema.nullable(),
  count: int(1, 999).nullable(),
});
export type RuleCore = z.infer<typeof ruleCoreSchema>;

function checkRule(rule: RuleCore, ctx: z.RefinementCtx) {
  if (rule.endType === 'onDate' && !rule.endDate) ctx.addIssue({ code: 'custom', message: 'endDate required' });
  if (rule.endType === 'afterCount' && !rule.count) ctx.addIssue({ code: 'custom', message: 'count required' });
  if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'pick at least one weekday' });
  }
}

export const ruleDraftSchema = ruleCoreSchema.superRefine(checkRule);

export const recurrenceRuleSchema = baseSchema
  .extend({ seriesType: z.enum(['task', 'routine']), seriesId: idSchema })
  .extend(ruleCoreSchema.shape)
  .superRefine(checkRule);
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const occurrenceSchema = baseSchema.extend({
  seriesType: z.enum(['task', 'routine']),
  seriesId: idSchema,
  ruleId: idSchema,
  originalDate: localDateSchema,
  date: localDateSchema,
  startTime: hhmmSchema.nullable(),
  durationMin: int(1, 1440).nullable(),
  title: trimmed(1, 200).nullable(),
  notes: z.string().max(5000).nullable(),
  status: z.enum(['scheduled', 'done', 'skipped']),
  completedAt: isoSchema.nullable(),
  completedStepIds: z.array(z.string().min(1).max(128)).max(60),
  isException: z.boolean(),
});
export type Occurrence = z.infer<typeof occurrenceSchema>;

export const reminderSchema = baseSchema.extend({
  targetType: z.enum(['task', 'routine', 'goal']),
  targetId: idSchema,
  kind: z.enum(['relative', 'absolute']),
  offsetMin: int(0, 10080).nullable(),
  atTime: hhmmSchema.nullable(),
  enabled: z.boolean(),
});
export type Reminder = z.infer<typeof reminderSchema>;

export const goalPeriodSchema = z.enum(['once', 'daily', 'weekly', 'monthly', 'yearly']);

/**
 * Goal reminder settings (synced with the goal; the OS schedule itself stays local). `beforeDue` lists day offsets
 * before the due date (0 = on the day); `monthlyDay` null = no monthly check-in; `periodic` = the daily / weekly
 * reminder of a daily / weekly goal.
 */
export const goalRemindersSchema = z.object({
  beforeDue: z
    .array(z.union([z.literal(0), z.literal(1), z.literal(7)]))
    .max(3)
    .refine((a) => new Set(a).size === a.length, 'duplicate offset'),
  beforeDueTime: hhmmSchema,
  eachStep: z.boolean(),
  monthlyDay: int(1, 31).nullable(),
  monthlyTime: hhmmSchema,
  periodic: z.boolean(),
  periodicTime: hhmmSchema,
  periodicWeekday: int(0, 6),
});
export type GoalReminders = z.infer<typeof goalRemindersSchema>;

export const DEFAULT_GOAL_REMINDERS: GoalReminders = {
  beforeDue: [],
  beforeDueTime: '09:00',
  eachStep: false,
  monthlyDay: null,
  monthlyTime: '09:00',
  periodic: false,
  periodicTime: '09:00',
  periodicWeekday: 1,
};

/** One ended period of a periodic goal and the share of its linked work that was done. */
export const goalHistoryEntrySchema = z.object({
  start: localDateSchema,
  end: localDateSchema,
  percent: int(0, 100),
  done: int(0, 100000),
  total: int(0, 100000),
});
export type GoalHistoryEntry = z.infer<typeof goalHistoryEntrySchema>;
export const GOAL_HISTORY_MAX = 60;

export const goalSchema = baseSchema
  .extend({
    title: trimmed(1, 120),
    description: z.string().max(2000).nullable(),
    /** Due date of a one-time goal; null for periodic goals (their due date is the end of the current period). */
    targetDate: localDateSchema.nullable(),
    status: z.enum(['active', 'achieved', 'archived']),
    color: categoryColorSchema.nullable(),
    progressMode: z.enum(['milestones', 'tasks', 'manual']),
    manualProgress: int(0, 100),
    achievedAt: isoSchema.nullable(),
    // Migration 002. Defaults keep documents written before it valid.
    period: goalPeriodSchema.default('once'),
    /** Start of the first period (periodic goals); optional start of a one-time goal. */
    startDate: localDateSchema.nullable().default(null),
    reminders: goalRemindersSchema.default(DEFAULT_GOAL_REMINDERS),
    history: z.array(goalHistoryEntrySchema).max(GOAL_HISTORY_MAX).default([]),
  })
  .superRefine((g, ctx) => {
    // Same cross-field checks as goalOk / historyEntryOk in firebase/firestore.rules.
    if (g.period !== 'once' && (g.startDate === null || g.targetDate !== null)) {
      ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'periodic goals need a start and no due date' });
    }
    if (g.period === 'once' && g.startDate && g.targetDate && g.startDate > g.targetDate) {
      ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'due date before start' });
    }
    for (const [i, h] of g.history.entries()) {
      if (h.start > h.end || h.done > h.total) {
        ctx.addIssue({ code: 'custom', path: ['history', i], message: 'invalid history entry' });
      }
    }
  });
export type Goal = z.infer<typeof goalSchema>;

export const milestoneSchema = baseSchema.extend({
  goalId: idSchema,
  title: trimmed(1, 120),
  dueDate: localDateSchema.nullable(),
  completedAt: isoSchema.nullable(),
  sortOrder: int(0, 10000),
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const routineStepSchema = z.object({
  id: z.string().min(1).max(64),
  title: trimmed(1, 80),
  durationMin: int(1, 600).nullable().optional(),
});

export const routineSchema = baseSchema.extend({
  title: trimmed(1, 80),
  partOfDay: z.enum(['morning', 'afternoon', 'evening', 'anytime']),
  startTime: hhmmSchema.nullable(),
  steps: z.array(routineStepSchema).max(30),
  categoryId: idSchema.nullable(),
  active: z.boolean(),
  recurrenceRuleId: idSchema.nullable(),
});
export type Routine = z.infer<typeof routineSchema>;

/** Device preferences mirrored into the synced profile (theme, day window). */
export const themeSchema = profileSchema.shape.theme;
