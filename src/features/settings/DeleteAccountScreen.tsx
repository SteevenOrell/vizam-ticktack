import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { authErrorKey } from '../../services/auth';
import { deleteAccountFlow } from '../../services/accountFlows';
import { usePreferences } from '../../state/preferences';
import { useSession } from '../../state/session';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFlowDeps } from '../session/SessionProvider';

/**
 * Account deletion (store requirement): password re-entry, explicit confirmation, then every cloud document, the
 * account and the data on this device are deleted.
 */
export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { colors, header } = useTheme();
  const router = useRouter();
  const deps = useFlowDeps();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);

  const run = async () => {
    setConfirm(false);
    if (!deps) return;
    setWorking(true);
    useSession.getState().setBusy(true);
    try {
      await deleteAccountFlow(deps, password);
      useSession.getState().setGuest();
      usePreferences.getState().setOnboardingDone(false);
      router.replace('/onboarding');
    } catch (e) {
      setError(t(`auth.errors.${authErrorKey(e, 'delete')}`));
    } finally {
      useSession.getState().setBusy(false);
      setWorking(false);
    }
  };

  return (
    <HeaderScreen
      testID="screen-delete-account"
      title={t('deleteAccount.title')}
      action={
        <Button
          label={t('modal.close')}
          variant="secondary"
          size="compact"
          icon="close"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/me'))}
        />
      }
      header={
        <Text variant="bodySm" color={header.on.textSecondary} style={styles.sub}>
          {t('deleteAccount.subtitle')}
        </Text>
      }
    >
      <View style={styles.form}>
        <Text variant="body" color={colors.textSecondary}>
          {t('deleteAccount.body')}
        </Text>
        <TextField
          testID="field-password"
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          error={error}
        />
        <Button
          label={working ? t('auth.working') : t('deleteAccount.action')}
          variant="destructive"
          icon="trash"
          disabled={!signedIn || !password || working}
          onPress={() => setConfirm(true)}
          fullWidth
        />
      </View>
      <ConfirmDialog
        visible={confirm}
        title={t('deleteAccount.confirmTitle')}
        body={t('deleteAccount.confirmBody')}
        actions={[{ label: t('deleteAccount.action'), variant: 'destructive', onPress: () => void run() }]}
        onCancel={() => setConfirm(false)}
        cancelLabel={t('editor.cancel')}
      />
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  sub: { marginTop: space.sm },
  form: { gap: space.md, paddingBottom: space.xxl },
});
