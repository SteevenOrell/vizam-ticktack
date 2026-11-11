import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useDatabase } from '../../data/DatabaseProvider';
import { discardFailedItem, listFailedSync, retryFailedItem, type FailedSyncItem } from '../../data/settings';
import { useQuery } from '../../data/useQuery';
import { retryFailed } from '../../sync/engine';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { StackScreen } from '../../ui/StackScreen';
import { AsyncContent, EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useDataContext, useServices } from '../session/SessionProvider';

/** Error code from the sync engine -> translation key suffix; anything else reads as "unknown". */
const KNOWN_ERRORS = ['permission-denied', 'invalid-argument', 'failed-precondition', 'out-of-range'] as const;
const KNOWN_TYPES = [
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

export function errorKey(code: string | null): (typeof KNOWN_ERRORS)[number] | 'unknown' {
  return (KNOWN_ERRORS as readonly string[]).includes(code ?? '') ? (code as (typeof KNOWN_ERRORS)[number]) : 'unknown';
}

/** Me > Sync problems: changes the server refused, each with its entity, error, Retry and Discard (with confirm). */
export function FailedSyncScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const database = useDatabase();
  const ctx = useDataContext();
  const { syncNow } = useServices();
  const ownerId = ctx?.ownerId ?? 'local';
  const query = useCallback((db: Parameters<typeof listFailedSync>[0]) => listFailedSync(db, ownerId), [ownerId]);
  const state = useQuery(query);
  const [discarding, setDiscarding] = useState<FailedSyncItem | null>(null);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/me');
  }, [router]);

  const db = database.status === 'ready' ? database.db : null;
  const retryOne = async (item: FailedSyncItem) => {
    if (!db) return;
    await retryFailedItem(db, item.entityType, item.entityId);
    void syncNow();
  };
  const retryAll = async () => {
    if (!db) return;
    await retryFailed(db);
    void syncNow();
  };
  const discard = async () => {
    const item = discarding;
    setDiscarding(null);
    if (db && item) await discardFailedItem(db, item.entityType, item.entityId);
  };

  const typeLabel = (type: FailedSyncItem['entityType']) =>
    t(`failedSync.types.${(KNOWN_TYPES as readonly string[]).includes(type) ? type : 'tasks'}`);

  return (
    <StackScreen testID="screen-failed-sync" title={t('failedSync.title')} backLabel={t('details.back')} onBack={back}>
      <AsyncContent
        state={state}
        onRetry={state.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon="check" title={t('failedSync.emptyTitle')} body={t('failedSync.emptyBody')} />}
      >
        {(items) => (
          <View style={styles.list}>
            <Text variant="bodySm" color={colors.textSecondary}>
              {t('failedSync.intro')}
            </Text>
            {items.length > 1 ? (
              <Button
                label={t('failedSync.retryAll', { count: items.length })}
                variant="secondary"
                icon="refresh"
                onPress={() => void retryAll()}
                testID="failed-retry-all"
              />
            ) : null}
            {items.map((item) => (
              <Card key={`${item.entityType}:${item.entityId}`} style={styles.card} testID={`failed-${item.entityId}`}>
                <View
                  accessible
                  accessibilityLabel={`${typeLabel(item.entityType)}, ${item.label ?? t('failedSync.untitled')}. ${t(`failedSync.errors.${errorKey(item.error)}`)}`}
                >
                  <Text variant="label" color={colors.textSecondary}>
                    {typeLabel(item.entityType)}
                    {item.op === 'delete' ? ` · ${t('failedSync.deleteOp')}` : ''}
                  </Text>
                  <Text variant="title3">{item.label ?? t('failedSync.untitled')}</Text>
                  <Text variant="bodySm" color={colors.danger}>
                    {t(`failedSync.errors.${errorKey(item.error)}`)}
                  </Text>
                </View>
                <View style={styles.buttons}>
                  <Button
                    label={t('failedSync.retry')}
                    variant="secondary"
                    size="compact"
                    icon="refresh"
                    onPress={() => void retryOne(item)}
                    accessibilityLabel={t('failedSync.retryItem', { name: item.label ?? typeLabel(item.entityType) })}
                    testID={`failed-retry-${item.entityId}`}
                  />
                  <Button
                    label={t('failedSync.discard')}
                    variant="destructive"
                    size="compact"
                    icon="trash"
                    onPress={() => setDiscarding(item)}
                    accessibilityLabel={t('failedSync.discardItem', { name: item.label ?? typeLabel(item.entityType) })}
                    testID={`failed-discard-${item.entityId}`}
                  />
                </View>
              </Card>
            ))}
          </View>
        )}
      </AsyncContent>
      <ConfirmDialog
        visible={discarding !== null}
        title={t('failedSync.discardTitle')}
        body={t('failedSync.discardBody')}
        actions={[
          {
            label: t('failedSync.discard'),
            variant: 'destructive',
            onPress: () => void discard(),
            testID: 'failed-discard-confirm',
          },
        ]}
        onCancel={() => setDiscarding(null)}
        cancelLabel={t('editor.cancel')}
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  card: { gap: space.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
