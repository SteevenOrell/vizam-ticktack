import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';

import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { flushDeletes, undoDelete, usePendingDeletes } from './pendingDeletes';

/**
 * "Task deleted · Undo" bar for the latest pending delete (5 s). Sits above the tab bar; announced politely.
 * Pending deletes are committed when the app goes to the background.
 */
export function UndoSnackbar({ bottom }: { bottom: number }) {
  const { t } = useTranslation();
  const { scheme } = useTheme();
  const latest = usePendingDeletes((s) => s.pending.filter((x) => !x.committed).at(-1) ?? null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushDeletes();
    });
    return () => sub.remove();
  }, []);

  if (!latest) return null;
  // Inverted surface so the bar stands out from the list in both themes.
  const bg = scheme === 'dark' ? '#F4F1EC' : '#25282A';
  const fg = scheme === 'dark' ? '#17191B' : '#FFFFFF';
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: bg }]} testID="undo-snackbar" accessibilityLiveRegion="polite">
        <Text variant="bodySm" weight={500} color={fg} style={styles.flex} numberOfLines={2}>
          {latest.kind === 'goal'
            ? t('goals.deleted', { title: latest.label })
            : t('tasks.deleted', { title: latest.label })}
        </Text>
        <Button
          testID="undo-delete"
          label={t('tasks.undo')}
          variant="primary"
          size="compact"
          onPress={() => undoDelete(latest.id)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 520,
    minHeight: 52,
    borderRadius: radii.input,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.xxs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    boxShadow: '0px 6px 20px rgba(0, 0, 0, 0.25)',
  },
  flex: { flex: 1 },
});
