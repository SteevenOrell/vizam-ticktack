import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { getRoutineDetail, type RoutineDetail } from '../../data/routines';
import { useQuery } from '../../data/useQuery';
import { localDateOf } from '../../domain/localDate';
import { shortDate } from '../../i18n/dates';
import { formatClock, noonOf } from '../../lib/dates';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { StackScreen } from '../../ui/StackScreen';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext } from '../session/SessionProvider';
import { repeatSummary } from '../tasks/repeatSummary';
import { RoutineRunner } from './RoutineRunner';

function reminderLine(t: ReturnType<typeof useTranslation>['t'], lang: string, d: RoutineDetail): string {
  if (!d.reminder) return t('reminders.itemNone');
  return d.routine.startTime
    ? t(`reminders.itemOffset_${d.reminder.offsetMin}` as never, {
        defaultValue: t('reminders.itemOffsetOther', { count: d.reminder.offsetMin }),
      })
    : t('reminders.itemSummaryAt', { time: formatClock(d.reminder.atTime, lang) });
}

/** One routine: overview (steps, schedule, reminder, recent runs) with Start, and the step-by-step runner. */
export function RoutineScreen({ routineId, now = new Date() }: { routineId: string; now?: Date }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const ctx = useDataContext();
  const lang = i18n.language;
  const today = localDateOf(now);
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback(
    (db: Parameters<typeof getRoutineDetail>[0]) => getRoutineDetail(db, ownerId, routineId, today),
    [ownerId, routineId, today],
  );
  const state = useQuery(query);
  const [running, setRunning] = useState(false);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/routines');
  }, [router]);
  const detail = state.status === 'success' ? state.data : null;

  return (
    <StackScreen
      testID="screen-routine"
      backLabel={t('routines.back')}
      onBack={running ? () => setRunning(false) : back}
      action={
        detail && !running ? (
          <Button
            testID="edit-routine"
            label={t('routines.edit')}
            variant="secondary"
            size="compact"
            icon="edit"
            onPress={() => router.push({ pathname: '/routine/edit/[id]', params: { id: routineId } })}
          />
        ) : undefined
      }
    >
      <AsyncContent
        state={state}
        onRetry={state.reload}
        isEmpty={(d) => d === null}
        empty={
          <EmptyState
            icon="routines"
            title={t('routines.notFound')}
            body={t('routines.notFoundBody')}
            action={{ label: t('routines.back'), onPress: back }}
          />
        }
      >
        {(d) => {
          if (!d) return null;
          const { routine } = d;
          if (running) {
            return (
              <RoutineRunner
                ctx={ctx}
                routineId={routine.id}
                title={routine.title}
                steps={routine.steps.map((s) => ({ id: s.id, title: s.title, durationMin: s.durationMin ?? null }))}
                date={today}
                onClose={() => {
                  setRunning(false);
                  state.reload();
                }}
              />
            );
          }
          const status = d.today.done
            ? t('routines.doneToday')
            : d.today.completedStepIds.length > 0
              ? t('routines.progressToday', { done: d.today.completedStepIds.length, total: routine.steps.length })
              : d.today.scheduled
                ? t('routines.plannedToday')
                : t('routines.notToday');
          return (
            <View style={styles.stack} testID="routine-overview">
              <View style={styles.titleBlock}>
                <Text variant="title1" accessibilityRole="header">
                  {routine.title}
                </Text>
                <Text variant="bodySm" color={colors.textSecondary}>
                  {[
                    t(`routines.part_${routine.partOfDay}`),
                    routine.startTime ? formatClock(routine.startTime, lang) : null,
                    t('routines.steps', { count: routine.steps.length }),
                    d.totalMin > 0 ? t('routines.minutes', { count: d.totalMin }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text
                  variant="label"
                  color={d.today.done ? colors.success : colors.textSecondary}
                  testID="routine-today-status"
                >
                  {status}
                </Text>
              </View>

              <Button
                testID="routine-start"
                label={d.today.done ? t('routines.startAgain') : t('routines.start')}
                icon="check"
                onPress={() => setRunning(true)}
                disabled={routine.steps.length === 0}
                fullWidth
              />

              <View style={styles.section}>
                <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                  {t('routines.stepsTitle')}
                </Text>
                {routine.steps.map((s, i) => (
                  <Card key={s.id} style={styles.stepRow} testID={`routine-step-row-${i}`}>
                    <Text variant="label" color={colors.textSecondary} style={styles.num}>
                      {i + 1}
                    </Text>
                    <Text variant="body" weight={500} style={styles.flex}>
                      {s.title}
                    </Text>
                    {s.durationMin ? (
                      <Text variant="caption" color={colors.textSecondary}>
                        {t('routines.minutes', { count: s.durationMin })}
                      </Text>
                    ) : null}
                  </Card>
                ))}
              </View>

              <View style={styles.section}>
                <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                  {t('routines.schedule')}
                </Text>
                <Card style={styles.line}>
                  <Icon name="repeat" size={18} color={colors.textSecondary} />
                  <Text variant="bodySm" style={styles.flex} testID="routine-schedule">
                    {d.rule ? repeatSummary(t, lang, d.rule) : '—'}
                  </Text>
                </Card>
                <Card style={styles.line}>
                  <Icon name="bell" size={18} color={d.reminder ? colors.accentText : colors.textSecondary} />
                  <Text variant="bodySm" style={styles.flex} testID="routine-reminder">
                    {reminderLine(t, lang, d)}
                  </Text>
                </Card>
              </View>

              <View style={styles.section} testID="routine-runs">
                <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
                  {t('routines.recent')}
                </Text>
                {d.runs.length === 0 ? (
                  <Text variant="bodySm" color={colors.textSecondary}>
                    {t('routines.recentEmpty')}
                  </Text>
                ) : (
                  d.runs.map((r) => (
                    <Text key={r.date} variant="bodySm">
                      {t('routines.runRow', {
                        date: shortDate(noonOf(r.date), lang),
                        done: r.done,
                        total: r.total,
                      })}
                    </Text>
                  ))
                )}
              </View>
            </View>
          );
        }}
      </AsyncContent>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  flex: { flex: 1, minWidth: 0 },
  titleBlock: { gap: space.xxs },
  section: { gap: space.xs },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  num: { width: 24, textAlign: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
