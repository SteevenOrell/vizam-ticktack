/**
 * One definition per synced entity: SQLite table, Firestore collection, Zod schema and the column map. Repositories
 * and the sync mappers are generic over these, so a field is declared exactly once.
 */
import type { z } from 'zod';

import {
  categorySchema,
  goalSchema,
  milestoneSchema,
  occurrenceSchema,
  profileSchema,
  recurrenceRuleSchema,
  reminderSchema,
  routineSchema,
  taskSchema,
} from '../domain/models';
import type { SqlValue } from './db/driver';

export type FieldKind = 'text' | 'int' | 'bool' | 'json';

export const ENTITY_TYPES = [
  'profile',
  'categories',
  'tasks',
  'recurrenceRules',
  'occurrences',
  'reminders',
  'goals',
  'milestones',
  'routines',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EntityDef<S extends z.ZodType = z.ZodType> {
  type: EntityType;
  table: string;
  schema: S;
  /** camelCase field -> [snake_case column, kind]. Includes the shared base fields. */
  fields: Record<string, readonly [string, FieldKind]>;
}

const base = {
  id: ['id', 'text'],
  ownerId: ['owner_id', 'text'],
  createdAt: ['created_at', 'text'],
  clientUpdatedAt: ['client_updated_at', 'text'],
  serverUpdatedAt: ['server_updated_at', 'int'],
  deleted: ['deleted', 'bool'],
  schemaVersion: ['schema_version', 'int'],
} as const;

function def<S extends z.ZodType>(
  type: EntityType,
  table: string,
  schema: S,
  fields: Record<string, readonly [string, FieldKind]>,
): EntityDef<S> {
  return { type, table, schema, fields: { ...base, ...fields } };
}

export const entities = {
  profile: def('profile', 'profile', profileSchema, {
    displayName: ['display_name', 'text'],
    timeZone: ['time_zone', 'text'],
    weekStartsOn: ['week_starts_on', 'int'],
    theme: ['theme', 'text'],
    dayStart: ['day_start', 'text'],
    dayEnd: ['day_end', 'text'],
    dailyCapacityMin: ['daily_capacity_min', 'int'],
    defaultReminderOffsetMin: ['default_reminder_offset_min', 'int'],
    onboardingCompletedAt: ['onboarding_completed_at', 'text'],
  }),
  categories: def('categories', 'categories', categorySchema, {
    name: ['name', 'text'],
    color: ['color', 'text'],
    icon: ['icon', 'text'],
    sortOrder: ['sort_order', 'int'],
    archived: ['archived', 'bool'],
  }),
  tasks: def('tasks', 'tasks', taskSchema, {
    title: ['title', 'text'],
    notes: ['notes', 'text'],
    status: ['status', 'text'],
    priority: ['priority', 'int'],
    categoryId: ['category_id', 'text'],
    goalId: ['goal_id', 'text'],
    milestoneId: ['milestone_id', 'text'],
    parentTaskId: ['parent_task_id', 'text'],
    date: ['date', 'text'],
    startTime: ['start_time', 'text'],
    durationMin: ['duration_min', 'int'],
    sortOrder: ['sort_order', 'int'],
    completedAt: ['completed_at', 'text'],
    recurrenceRuleId: ['recurrence_rule_id', 'text'],
  }),
  recurrenceRules: def('recurrenceRules', 'recurrence_rules', recurrenceRuleSchema, {
    seriesType: ['series_type', 'text'],
    seriesId: ['series_id', 'text'],
    freq: ['freq', 'text'],
    interval: ['interval', 'int'],
    byWeekday: ['by_weekday', 'json'],
    byMonthDay: ['by_month_day', 'int'],
    weekStartsOn: ['week_starts_on', 'int'],
    startDate: ['start_date', 'text'],
    endType: ['end_type', 'text'],
    endDate: ['end_date', 'text'],
    count: ['count', 'int'],
  }),
  occurrences: def('occurrences', 'task_occurrences', occurrenceSchema, {
    seriesType: ['series_type', 'text'],
    seriesId: ['series_id', 'text'],
    ruleId: ['rule_id', 'text'],
    originalDate: ['original_date', 'text'],
    date: ['date', 'text'],
    startTime: ['start_time', 'text'],
    durationMin: ['duration_min', 'int'],
    title: ['title', 'text'],
    notes: ['notes', 'text'],
    status: ['status', 'text'],
    completedAt: ['completed_at', 'text'],
    completedStepIds: ['completed_step_ids', 'json'],
    isException: ['is_exception', 'bool'],
  }),
  reminders: def('reminders', 'reminders', reminderSchema, {
    targetType: ['target_type', 'text'],
    targetId: ['target_id', 'text'],
    kind: ['kind', 'text'],
    offsetMin: ['offset_min', 'int'],
    atTime: ['at_time', 'text'],
    enabled: ['enabled', 'bool'],
  }),
  goals: def('goals', 'goals', goalSchema, {
    title: ['title', 'text'],
    description: ['description', 'text'],
    targetDate: ['target_date', 'text'],
    status: ['status', 'text'],
    color: ['color', 'text'],
    progressMode: ['progress_mode', 'text'],
    manualProgress: ['manual_progress', 'int'],
    achievedAt: ['achieved_at', 'text'],
  }),
  milestones: def('milestones', 'milestones', milestoneSchema, {
    goalId: ['goal_id', 'text'],
    title: ['title', 'text'],
    dueDate: ['due_date', 'text'],
    completedAt: ['completed_at', 'text'],
    sortOrder: ['sort_order', 'int'],
  }),
  routines: def('routines', 'routines', routineSchema, {
    title: ['title', 'text'],
    partOfDay: ['part_of_day', 'text'],
    startTime: ['start_time', 'text'],
    steps: ['steps', 'json'],
    categoryId: ['category_id', 'text'],
    active: ['active', 'bool'],
    recurrenceRuleId: ['recurrence_rule_id', 'text'],
  }),
} satisfies Record<EntityType, EntityDef>;

export type Entities = typeof entities;
export type EntityOf<K extends EntityType> = z.infer<Entities[K]['schema']>;

/** Rows as stored in SQLite: column -> value, plus the local-only sync columns. */
export type SqlRow = Record<string, SqlValue> & { local_rev?: number; dirty?: number };

export function rowToEntity<K extends EntityType>(type: K, row: SqlRow): EntityOf<K> {
  const d = entities[type] as EntityDef;
  const out: Record<string, unknown> = {};
  for (const [field, [col, kind]] of Object.entries(d.fields)) {
    const v = row[col];
    if (v === null || v === undefined) out[field] = null;
    else if (kind === 'bool') out[field] = v === 1 || v === '1';
    else if (kind === 'json') out[field] = typeof v === 'string' ? JSON.parse(v) : v;
    else out[field] = v;
  }
  return out as EntityOf<K>;
}

export function entityToColumns(type: EntityType, entity: Record<string, unknown>): Record<string, SqlValue> {
  const d = entities[type] as EntityDef;
  const out: Record<string, SqlValue> = {};
  for (const [field, [col, kind]] of Object.entries(d.fields)) {
    const v = entity[field];
    if (v === null || v === undefined) out[col] = null;
    else if (kind === 'bool') out[col] = v ? 1 : 0;
    else if (kind === 'json') out[col] = JSON.stringify(v);
    else out[col] = v as SqlValue;
  }
  return out;
}

/** Validates against the entity schema, throwing a ZodError listing the bad fields (never the values). */
export function parseEntity<K extends EntityType>(type: K, value: unknown): EntityOf<K> {
  return (entities[type].schema as z.ZodType).parse(value) as EntityOf<K>;
}
