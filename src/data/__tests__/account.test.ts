import { context, count, freshDb, TODAY } from '../../../tests/support/db';
import { occurrenceId } from '../../domain/recurrence/generator';
import {
  adoptGuestData,
  bindAccount,
  countGuestItems,
  getBoundUid,
  pendingChangeCount,
  wipeLocalData,
} from '../account';
import type { SqlDriver } from '../db/driver';
import { ensureDefaultCategories, ensureProfile, getProfile, GUEST_PROFILE_ID, updateProfile } from '../profile';
import { createTask, emptyDraft, setDone } from '../tasks';

let db: SqlDriver;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const daily = {
  freq: 'daily',
  interval: 1,
  byWeekday: null,
  byMonthDay: null,
  weekStartsOn: 1,
  endType: 'never',
  endDate: null,
  count: null,
} as const;

async function guestData() {
  const guest = context(db, 'local');
  await ensureProfile(guest, { timeZone: 'America/Toronto', weekStartsOn: 1 });
  await ensureDefaultCategories(guest, 'fr');
  await createTask(guest, { ...emptyDraft(TODAY), title: 'Guest task' });
  const series = await createTask(guest, { ...emptyDraft(TODAY), title: 'Guest series', repeat: daily });
  await setDone(guest, { taskId: series.id, occurrenceId: occurrenceId(series.id, TODAY) }, true);
  return series;
}

describe('guest -> account', () => {
  it('re-owns all guest rows to the uid and queues them, except generated occurrences', async () => {
    await guestData();
    expect(await countGuestItems(db)).toBe(2);
    await adoptGuestData(db, 'uid-1', { keepGuestProfile: true });

    expect(await count(db, "SELECT count(*) AS n FROM tasks WHERE owner_id = 'local'")).toBe(0);
    expect(await count(db, "SELECT count(*) AS n FROM task_occurrences WHERE owner_id = 'local'")).toBe(0);
    expect(await getBoundUid(db)).toBe('uid-1');
    const profile = await getProfile({ db, ownerId: 'uid-1' });
    expect(profile?.id).toBe('uid-1');
    expect(await count(db, 'SELECT count(*) AS n FROM profile WHERE id = ?', [GUEST_PROFILE_ID])).toBe(0);

    // Outbox: profile + 4 categories + 2 tasks + 1 rule + 1 exception = 9; generated occurrences are not queued.
    const queued = await db.all<{ entity_type: string }>('SELECT entity_type FROM outbox ORDER BY entity_type');
    expect(queued.filter((q) => q.entity_type === 'occurrences')).toHaveLength(1);
    expect(queued).toHaveLength(9);
    expect(await pendingChangeCount(db)).toBe(9);
  });

  it('drops the guest profile when signing in to an existing account', async () => {
    await guestData();
    await adoptGuestData(db, 'uid-2', { keepGuestProfile: false });
    expect(await count(db, 'SELECT count(*) AS n FROM profile')).toBe(0);
    expect(await count(db, "SELECT count(*) AS n FROM outbox WHERE entity_type = 'profile'")).toBe(0);
  });

  it('refuses to merge into a device bound to another account', async () => {
    await guestData();
    expect(await bindAccount(db, 'uid-1')).toBe(true);
    expect(await bindAccount(db, 'uid-9')).toBe(false);
    await expect(adoptGuestData(db, 'uid-9', { keepGuestProfile: true })).rejects.toThrow(/another account/);
    expect(await count(db, "SELECT count(*) AS n FROM tasks WHERE owner_id = 'local'")).toBe(2);
  });

  it('wipes every local row on sign-out', async () => {
    await guestData();
    await adoptGuestData(db, 'uid-1', { keepGuestProfile: true });
    await wipeLocalData(db);
    for (const table of ['tasks', 'task_occurrences', 'profile', 'categories', 'outbox', 'sync_state']) {
      expect(await count(db, `SELECT count(*) AS n FROM ${table}`)).toBe(0);
    }
  });
});

describe('profile and categories', () => {
  it('creates starter categories in French and does not duplicate them', async () => {
    const ctx = context(db);
    expect(await ensureDefaultCategories(ctx, 'fr')).toBe(4);
    expect(await ensureDefaultCategories(ctx, 'fr')).toBe(0);
    const names = await db.all<{ name: string }>('SELECT name FROM categories ORDER BY sort_order');
    expect(names.map((n) => n.name)).toEqual(['Travail concentré', 'Santé', 'Maison', 'Apprentissage']);
  });

  it('mirrors preferences into the profile only when they change', async () => {
    const ctx = context(db);
    await ensureProfile(ctx, { timeZone: 'Europe/Paris', weekStartsOn: 1 });
    await updateProfile(ctx, { theme: 'dark' });
    await updateProfile(ctx, { theme: 'dark' });
    const rev = await db.first<{ local_rev: number }>('SELECT local_rev FROM profile');
    expect(rev?.local_rev).toBe(2);
  });
});
