import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { getTodaySummary, type TodaySummary } from '../../data/queries/overview';
import { useQuery } from '../../data/useQuery';
import { dayFaceParts } from '../../i18n/dates';
import { formatClock, formatMinutes, localDate } from '../../lib/dates';
import { Card } from '../../ui/Card';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { ProgressBar } from '../../ui/ProgressBar';
import { RoundAction } from '../../ui/RoundAction';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

export function TodayScreen({ now = new Date() }: { now?: Date }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const lang = i18n.language;
  const date = localDate(now);
  const query = useCallback((db: Parameters<typeof getTodaySummary>[0]) => getTodaySummary(db, date), [date]);
  const state = useQuery(query);
  const face = useMemo(() => dayFaceParts(now, lang), [now, lang]);
  const on = theme.header.on;

  const summary: TodaySummary | null = state.status === 'success' ? state.data : null;
  const planned = formatMinutes(summary?.plannedMin ?? 0, lang);
  const capacity = formatMinutes(summary?.capacityMin ?? 480, lang);
  const addTask = () => router.push('/task/new');

  return (
    <View style={styles.flex}>
      <HeaderScreen
        testID="screen-today"
        title={t('today.title')}
        action={
          <RoundAction
            icon="bell"
            accessibilityLabel={t('today.remindersAction')}
            background={on.actionBg}
            foreground={on.actionFg}
            accessibilityHint={t('states.comingSoon')}
          />
        }
        header={
          <View style={styles.face}>
            <View style={styles.faceRow}>
              <Text variant="dayFace" color={on.text}>
                {face.day}
              </Text>
              <View style={styles.faceMeta}>
                <Text variant="title2" color={on.text}>
                  {face.month}
                </Text>
                <Text variant="bodySm" color={on.textSecondary} style={lang === 'fr' ? null : styles.weekday}>
                  {face.weekday}
                </Text>
              </View>
            </View>
            <ProgressBar
              value={summary ? summary.plannedMin / Math.max(1, summary.capacityMin) : 0}
              fill={on.fill}
              track={on.trackBg}
              accessibilityLabel={t('today.workloadLabel', { planned, capacity })}
            />
            <Text variant="label" color={on.textSecondary}>
              {t('today.workload', { planned, capacity })}
            </Text>
          </View>
        }
      >
        <AsyncContent
          state={state}
          onRetry={state.reload}
          isEmpty={(d) => d.tasks.length === 0}
          empty={
            <EmptyState
              icon="today"
              title={t('today.emptyTitle')}
              body={t('today.emptyBody')}
              action={{ label: t('today.addTask'), onPress: addTask }}
            />
          }
        >
          {(d) => (
            <View style={styles.list}>
              <Text variant="label" color={theme.colors.textSecondary} accessibilityRole="header">
                {t('today.openTasks')} · {t('today.taskCount', { count: d.tasks.length })}
              </Text>
              {d.tasks.map((task) => (
                <Card key={task.id} style={styles.row}>
                  <Text variant="title3" style={styles.flex}>
                    {task.title}
                  </Text>
                  {task.startTime ? (
                    <Text variant="label" color={theme.colors.textSecondary} style={styles.time}>
                      {formatClock(task.startTime, lang)}
                    </Text>
                  ) : null}
                </Card>
              ))}
            </View>
          )}
        </AsyncContent>
      </HeaderScreen>
      <View style={styles.fab} pointerEvents="box-none">
        <RoundAction icon="plus" accessibilityLabel={t('today.addTask')} onPress={addTask} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  face: { marginTop: space.lg, gap: space.sm },
  faceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  faceMeta: { paddingBottom: space.xs, flexShrink: 1 },
  weekday: { textTransform: 'capitalize' },
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  time: { fontVariant: ['tabular-nums'] },
  fab: { position: 'absolute', right: space.lg, bottom: space.lg },
});
