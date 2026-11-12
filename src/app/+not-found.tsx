import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { space } from '../ui/theme/layout';
import { useTheme } from '../ui/theme/ThemeProvider';

export default function NotFound() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <Text variant="title1" align="center" accessibilityRole="header">
        {t('notFound.title')}
      </Text>
      <Button label={t('notFound.back')} onPress={() => router.replace('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.lg },
});
