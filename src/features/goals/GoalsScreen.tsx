import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { getGoalList, type GoalSummary } from '../../data/goals';
import { useQuery } from '../../data/useQuery';
import type { GoalSection } from '../../domain/goals';
import { localDateOf } from '../../domain/localDate';
import { ownerIdOf, useSession } from '../../state/session';
import { Button } from '../../ui/Button';
import { CategoryDot } from '../../ui/Checkbox';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { ProgressBar } from '../../ui/ProgressBar';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { fontFamilies } from '../../ui/theme/typography';
import { useFocusRing } from '../../ui/useFocusRing';
import { isGoalHidden, usePendingDeletes } from '../tasks/pendingDeletes';
import { countdown, dueLabel, periodLabel } from './goalFormat';

const SECTIONS: GoalSection[] = ['overdue', 'active', 'completed'];

export function GoalCard({ goal, onPress }: { goal: GoalSummary; onPress: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  const pct = goal.progress.percent;
  const overdue = goal.section === 'overdue';
  return (
    <Pressable
      {...focusHandlers}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${goal.title}, ${periodLabel(t, goal.period)}, ${t('goals.percentDone', { percent: pct })}, ${countdown(t, goal.daysLeft)}`}
      testID={`goal-card-${goal.id}`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: focused ? colors.focus : 'transparent' }]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardText}>
          <Text variant="title3" numberOfLines={2}>
            {goal.title}
          </Text>
          <View style={styles.metaRow}>
            <View style={[styles.chip, { backgroundColor: colors.chip }]}>
              {goal.color ? <CategoryDot color={goal.color} size={8} /> : null}
              <Text variant="caption" weight={500} color={colors.text}>
                {periodLabel(t, goal.period)}
              </Text>
            </View>
            <Text
              variant="caption"
              color={overdue ? colors.danger : colors.textSecondary}
              numberOfLines={1}
              style={styles.shrink}
            >
              {dueLabel(t, i18n.language, goal.period, goal.due)} · {countdown(t, goal.daysLeft)}
            </Text>
          </View>
        </View>
        <Text style={[styles.pct, { color: pct >= 100 ? colors.success : colors.text }]} accessible={false}>
          {pct}
          <Text style={[styles.pctSign, { color: colors.textSecondary }]}>%</Text>
        </Text>
      </View>
      <ProgressBar
        value={pct / 100}
        fill={colors.accent}
        track={colors.chip}
        accessibilityLabel={t('goals.progressLabel', { title: goal.title, percent: pct })}
      />
      <Text variant="caption" color={colors.textSecondary}>
        {t('goals.doneOfTotal', { done: goal.progress.done, total: goal.progress.total })}
      </Text>
    </Pressable>
  );
}

export function GoalsScreen({ now = new Date() }: { now?: Date }) {
  const { t } = useTranslation();
  const { colors, header } = useTheme();
  const router = useRouter();
  const ownerId = useSession(ownerIdOf);
  const today = localDateOf(now);
  const query = useCallback(
    (db: Parameters<typeof getGoalList>[0]) => getGoalList(db, ownerId, today),
    [ownerId, today],
  );
  const state = useQuery(query);
  const pending = usePendingDeletes((s) => s.pending);
  const visible = state.status === 'success' ? state.data.filter((g) => !isGoalHidden(g.id, pending)) : [];
  const activeCount = visible.filter((g) => g.section !== 'completed').length;
  const create = () => router.push('/goal/new');

  return (
    <HeaderScreen
      testID="screen-goals"
      title={t('goals.title')}
      action={
        <Button
          testID="new-goal"
          label={t('goals.newGoal')}
          variant="secondary"
          size="compact"
          icon="plus"
          onPress={create}
        />
      }
      header={
        activeCount > 0 ? (
          <Text variant="bodySm" color={header.on.textSecondary} style={styles.sub}>
            {t('goals.activeCount', { count: activeCount })}
          </Text>
        ) : undefined
      }
    >
      <AsyncContent
        state={state}
        onRetry={state.reload}
        isEmpty={(d) => d.filter((g) => !isGoalHidden(g.id, pending)).length === 0}
        empty={
          <EmptyState
            icon="goals"
            title={t('goals.emptyTitle')}
            body={t('goals.emptyBody')}
            action={{ label: t('goals.createGoal'), onPress: create }}
          />
        }
      >
        {() => (
          <View style={styles.sections}>
            {SECTIONS.map((section) => {
              const goals = visible.filter((g) => g.section === section);
              if (goals.length === 0) return null;
              return (
                <View key={section} style={styles.list} testID={`goals-section-${section}`}>
                  <Text
                    variant="label"
                    accessibilityRole="header"
                    color={section === 'overdue' ? colors.danger : colors.textSecondary}
                  >
                    {t(`goals.section_${section}`)} · {goals.length}
                  </Text>
                  {goals.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      onPress={() => router.push({ pathname: '/goal/[id]', params: { id: g.id } })}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </AsyncContent>
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  sub: { marginTop: space.xs },
  sections: { gap: space.xl },
  list: { gap: space.sm },
  card: { borderRadius: radii.card, padding: space.md, gap: space.xs, borderWidth: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  cardText: { flex: 1, minWidth: 0, gap: space.xxs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
  shrink: { flexShrink: 1 },
  pct: { fontFamily: fontFamilies.displaySemiBold, fontSize: 34, lineHeight: 38, fontVariant: ['tabular-nums'] },
  pctSign: { fontFamily: fontFamilies.displayMedium, fontSize: 18, lineHeight: 22 },
});
