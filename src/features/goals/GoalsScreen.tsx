import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { getActiveGoals } from '../../data/queries/overview';
import { useQuery } from '../../data/useQuery';
import { ownerIdOf, useSession } from '../../state/session';
import { Card } from '../../ui/Card';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

export function GoalsScreen() {
  const { t } = useTranslation();
  const { colors, header } = useTheme();
  const ownerId = useSession(ownerIdOf);
  const query = useCallback((db: Parameters<typeof getActiveGoals>[0]) => getActiveGoals(db, ownerId), [ownerId]);
  const state = useQuery(query);
  const count = state.status === 'success' ? state.data.length : 0;

  return (
    <HeaderScreen
      testID="screen-goals"
      title={t('goals.title')}
      header={
        count > 0 ? (
          <Text variant="bodySm" color={header.on.textSecondary} style={styles.sub}>
            {t('goals.activeCount', { count })}
          </Text>
        ) : undefined
      }
    >
      <AsyncContent
        state={state}
        onRetry={state.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon="goals" title={t('goals.emptyTitle')} body={t('goals.emptyBody')} />}
      >
        {(goals) => (
          <View style={styles.list}>
            {goals.map((g) => (
              <Card key={g.id}>
                <Text variant="title3">{g.title}</Text>
                {g.target_date ? (
                  <Text variant="caption" color={colors.textSecondary}>
                    {g.target_date}
                  </Text>
                ) : null}
              </Card>
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
});
