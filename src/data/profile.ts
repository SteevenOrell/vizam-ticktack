/**
 * Profile (one row per owner; Firestore `users/{uid}`) and default categories. The profile ID is the uid when signed
 * in and `local-profile` in guest mode.
 */
import { LOCAL_OWNER, type Profile } from '../domain/models';
import { getEntity, listEntities, mutate, nowIso, writeEntity, type DataContext } from './store';

export const GUEST_PROFILE_ID = 'local-profile';
export const profileIdFor = (ownerId: string) => (ownerId === LOCAL_OWNER ? GUEST_PROFILE_ID : ownerId);

export interface ProfileDefaults {
  timeZone: string;
  weekStartsOn: 0 | 1 | 6;
  theme?: Profile['theme'];
  dayStart?: string;
  dayEnd?: string;
}

export async function getProfile(ctx: Pick<DataContext, 'db' | 'ownerId'>): Promise<Profile | null> {
  return getEntity(ctx.db, 'profile', profileIdFor(ctx.ownerId), ctx.ownerId);
}

/** Returns the owner's profile, creating it with the device defaults the first time. */
export async function ensureProfile(ctx: DataContext, defaults: ProfileDefaults): Promise<Profile> {
  const existing = await getProfile(ctx);
  if (existing) return existing;
  return mutate(ctx, () =>
    writeEntity(ctx, 'profile', {
      id: profileIdFor(ctx.ownerId),
      displayName: null,
      timeZone: defaults.timeZone,
      weekStartsOn: defaults.weekStartsOn,
      theme: defaults.theme ?? 'system',
      dayStart: defaults.dayStart ?? '06:00',
      dayEnd: defaults.dayEnd ?? '19:00',
      dailyCapacityMin: 480,
      defaultReminderOffsetMin: 10,
      onboardingCompletedAt: null,
    }),
  );
}

export type ProfilePatch = Partial<
  Pick<
    Profile,
    'displayName' | 'theme' | 'dayStart' | 'dayEnd' | 'weekStartsOn' | 'dailyCapacityMin' | 'onboardingCompletedAt'
  >
>;

/** Updates synced profile fields; a no-op when nothing changes (avoids needless sync traffic). */
export async function updateProfile(ctx: DataContext, patch: ProfilePatch): Promise<Profile | null> {
  const current = await getProfile(ctx);
  if (!current) return null;
  const changed = (Object.keys(patch) as (keyof ProfilePatch)[]).some((k) => patch[k] !== current[k]);
  if (!changed) return current;
  return mutate(ctx, () => writeEntity(ctx, 'profile', { ...current, ...patch }));
}

export const defaultCategoryNames = {
  en: ['Focus work', 'Health', 'Home', 'Learning'],
  fr: ['Travail concentré', 'Santé', 'Maison', 'Apprentissage'],
} as const;

const defaultCategoryStyle = [
  { color: 'ember', icon: 'target' },
  { color: 'moss', icon: 'heart' },
  { color: 'sand', icon: 'home' },
  { color: 'plum', icon: 'book' },
] as const;

/** Creates the four starter categories (in the app language) when the owner has none. */
export async function ensureDefaultCategories(ctx: DataContext, language: string): Promise<number> {
  const existing = await listEntities(ctx.db, 'categories', ctx.ownerId);
  if (existing.length > 0) return 0;
  const names = language === 'fr' ? defaultCategoryNames.fr : defaultCategoryNames.en;
  await mutate(ctx, async () => {
    for (const [i, style] of defaultCategoryStyle.entries()) {
      await writeEntity(ctx, 'categories', {
        id: ctx.newId(),
        name: names[i] ?? names[0],
        color: style.color,
        icon: style.icon,
        sortOrder: i,
        archived: false,
      });
    }
  });
  return defaultCategoryStyle.length;
}

/** Marks onboarding complete in the synced profile. */
export async function completeOnboarding(ctx: DataContext): Promise<void> {
  await updateProfile(ctx, { onboardingCompletedAt: nowIso(ctx) });
}
