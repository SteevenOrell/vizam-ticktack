import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { getActiveRoutines } from '../../data/queries/overview';
import { useQuery } from '../../data/useQuery';
import { ownerIdOf, useSession } from '../../state/session';
import { Card } from '../../ui/Card';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

export function RoutinesScreen() {
  const { t } = useTranslation();
  const { header } = useTheme();
  const ownerId = useSession(ownerIdOf);
  const query = useCallback((db: Parameters<typeof getActiveRoutines>[0]) => getActiveRoutines(db, ownerId), [ownerId]);
  const state = useQuery(query);
  const count = state.status === 'success' ? state.data.length : 0;

  return (
    <HeaderScreen
      testID="screen-routines"
      title={t('routines.title')}
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
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon="routines" title={t('routines.emptyTitle')} body={t('routines.emptyBody')} />}
      >
        {(routines) => (
          <View style={styles.list}>
            {routines.map((r) => (
              <Card key={r.id}>
                <Text variant="title3">{r.title}</Text>
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
