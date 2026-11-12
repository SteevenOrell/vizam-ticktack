import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { getRoutineList, type RoutineSummary } from '../../data/routines';
import { useQuery } from '../../data/useQuery';
import { localDateOf } from '../../domain/localDate';
import { formatClock } from '../../lib/dates';
import { ownerIdOf, useSession } from '../../state/session';
import { Button } from '../../ui/Button';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { Icon } from '../../ui/Icon';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFocusRing } from '../../ui/useFocusRing';
import { isRoutineHidden, usePendingDeletes } from '../tasks/pendingDeletes';

function RoutineCard({ routine, onPress, lang }: { routine: RoutineSummary; onPress: () => void; lang: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const doneToday = routine.today.done;
  const status = doneToday
    ? t('routines.doneToday')
    : routine.today.completedStepIds.length > 0
      ? t('routines.progressToday', { done: routine.today.completedStepIds.length, total: routine.stepCount })
      : routine.today.scheduled
        ? t('routines.plannedToday')
        : t('routines.notToday');
  const meta = [
    t(`routines.part_${routine.partOfDay}`),
    routine.startTime ? formatClock(routine.startTime, lang) : null,
    t('routines.steps', { count: routine.stepCount }),
    routine.totalMin > 0 ? t('routines.minutes', { count: routine.totalMin }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      {...focusHandlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${routine.title}, ${meta}, ${status}`}
      testID={`routine-card-${routine.id}`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: focused ? colors.focus : 'transparent' }]}
    >
      <View style={styles.cardText}>
        <Text variant="title3" numberOfLines={2}>
          {routine.title}
        </Text>
        <Text variant="caption" color={colors.textSecondary}>
          {meta}
        </Text>
        <Text variant="label" color={doneToday ? colors.success : colors.textSecondary}>
          {status}
        </Text>
      </View>
      <Icon name="chevronRight" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

export function RoutinesScreen({ now = new Date() }: { now?: Date }) {
  const { t, i18n } = useTranslation();
  const { header } = useTheme();
  const router = useRouter();
  const ownerId = useSession(ownerIdOf);
  const pending = usePendingDeletes((s) => s.pending);
  const today = localDateOf(now);
  const query = useCallback(
    (db: Parameters<typeof getRoutineList>[0]) => getRoutineList(db, ownerId, today),
    [ownerId, today],
  );
  const state = useQuery(query);
  const count = state.status === 'success' ? state.data.filter((r) => !isRoutineHidden(r.id, pending)).length : 0;
  const create = () => router.push('/routine/new');

  return (
    <HeaderScreen
      testID="screen-routines"
      title={t('routines.title')}
      action={
        <Button
          testID="new-routine"
          label={t('routines.newRoutine')}
          variant="secondary"
          size="compact"
          icon="plus"
          onPress={create}
        />
      }
      header={
        count > 0 ? (
          <Text variant="bodySm" color={header.on.textSecondary} style={styles.sub}>
            {t('routines.count', { count })}
          </Text>
        ) : undefined
      }
    >
      <AsyncContent
        state={state}
        onRetry={state.reload}
        isEmpty={(d) => d.filter((r) => !isRoutineHidden(r.id, pending)).length === 0}
        empty={
          <EmptyState
            icon="routines"
            title={t('routines.emptyTitle')}
            body={t('routines.emptyBody')}
            action={{ label: t('routines.emptyAction'), onPress: create }}
          />
        }
      >
        {(routines) => (
          <View style={styles.list}>
            {routines
              .filter((r) => !isRoutineHidden(r.id, pending))
              .map((r) => (
                <RoutineCard
                  key={r.id}
                  routine={r}
                  lang={i18n.language}
                  onPress={() => router.push({ pathname: '/routine/[id]', params: { id: r.id } })}
                />
              ))}
          </View>
        )}
      </AsyncContent>
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  sub: { marginTop: space.xs },
  list: { gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radii.card,
    borderWidth: 2,
    padding: space.md,
    minHeight: 72,
  },
  cardText: { flex: 1, minWidth: 0, gap: space.xxs },
});
