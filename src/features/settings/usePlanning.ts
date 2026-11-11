import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { getPlanningSettings, type PlanningSettings, type WeekStart } from '../../data/settings';
import { useQuery } from '../../data/useQuery';
import { defaultWeekStartsOn } from '../../i18n/dates';
import { useDataContext } from '../session/SessionProvider';

/**
 * Week start and daily capacity from the synced profile (Me > Planning). Until the profile is read, or when it has
 * no week start yet, the language default applies (Monday in French, Sunday in English).
 */
export function usePlanning(): { weekStartsOn: WeekStart; dailyCapacityMin: number; ready: boolean } {
  const { i18n } = useTranslation();
  const ctx = useDataContext();
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback(
    (db: Parameters<typeof getPlanningSettings>[0]): Promise<PlanningSettings> => getPlanningSettings(db, ownerId),
    [ownerId],
  );
  const state = useQuery(query, { keepPrevious: true });
  const data = state.status === 'success' ? state.data : null;
  return {
    weekStartsOn: data?.weekStartsOn ?? defaultWeekStartsOn(i18n.language),
    dailyCapacityMin: data?.dailyCapacityMin ?? 480,
    ready: data !== null,
  };
}

export const useWeekStartsOn = (): WeekStart => usePlanning().weekStartsOn;
