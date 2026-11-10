import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/states';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

/** Placeholder modal route; the task form arrives in phase 3. */
export default function NewTaskModal() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg }]}>
      <View style={styles.row}>
        <Text variant="title1" accessibilityRole="header" style={styles.title}>
          {t('modal.newTaskTitle')}
        </Text>
        <Button
          label={t('modal.close')}
          variant="secondary"
          size="compact"
          icon="close"
          onPress={() => router.back()}
        />
      </View>
      <EmptyState icon="plus" title={t('modal.newTaskTitle')} body={t('states.comingSoon')} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  title: { flexShrink: 1 },
});
