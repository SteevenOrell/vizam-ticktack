import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { countGuestItems } from '../../data/account';
import { useDatabase } from '../../data/DatabaseProvider';
import { authErrorKey, emailSchema, passwordSchema } from '../../services/auth';
import { signInFlow, signUpFlow } from '../../services/accountFlows';
import { useSession } from '../../state/session';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { TextField } from '../../ui/TextField';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFlowDeps, useServices } from '../session/SessionProvider';

export type AuthMode = 'signIn' | 'signUp' | 'reset';

/**
 * Sign in / Sign up / Reset password (DESIGN.md section 7.2): two fields, large orange button, ghost links, inline
 * field errors. Messages never say whether an account exists.
 */
export function AuthScreen({ mode }: { mode: AuthMode }) {
  const { t } = useTranslation();
  const { colors, header } = useTheme();
  const router = useRouter();
  const database = useDatabase();
  const { gateway } = useServices();
  const deps = useFlowDeps();
  const setBusy = useSession((s) => s.setBusy);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setLocalBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [guestItems, setGuestItems] = useState(0);

  useEffect(() => {
    if (database.status !== 'ready' || mode === 'reset') return;
    void countGuestItems(database.db).then(setGuestItems, () => undefined);
  }, [database, mode]);

  const validate = useCallback(() => {
    const next: typeof errors = {};
    if (!emailSchema.safeParse(email).success) next.email = t('auth.errors.invalidEmail');
    if (mode === 'signUp' && !passwordSchema.safeParse(password).success) next.password = t('auth.errors.weakPassword');
    if (mode === 'signIn' && !password) next.password = t('auth.errors.passwordRequired');
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [email, password, mode, t]);

  const submit = useCallback(async () => {
    if (!validate()) return;
    setLocalBusy(true);
    setBusy(true);
    try {
      if (mode === 'reset') {
        await gateway?.sendReset(email);
        setSent(true);
        return;
      }
      if (!deps) throw new Error('unavailable');
      const user =
        mode === 'signUp' ? await signUpFlow(deps, email, password) : await signInFlow(deps, email, password);
      useSession.getState().setSignedIn(user.uid, user.email);
      router.replace('/');
    } catch (error) {
      const key = authErrorKey(error, mode);
      setErrors({ form: t(`auth.errors.${key}`) });
    } finally {
      setLocalBusy(false);
      setBusy(false);
    }
  }, [validate, setBusy, mode, gateway, email, deps, password, router, t]);

  const title =
    mode === 'signIn' ? t('auth.signInTitle') : mode === 'signUp' ? t('auth.signUpTitle') : t('auth.resetTitle');
  const available = !!gateway;

  return (
    <HeaderScreen
      testID={`screen-${mode === 'signIn' ? 'sign-in' : mode === 'signUp' ? 'sign-up' : 'reset'}`}
      title={title}
      action={
        <Button
          label={t('modal.close')}
          variant="secondary"
          size="compact"
          icon="close"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      }
      header={
        <Text variant="bodySm" color={header.on.textSecondary} style={styles.sub}>
          {mode === 'signIn' ? t('auth.signInBody') : mode === 'signUp' ? t('auth.signUpBody') : t('auth.resetBody')}
        </Text>
      }
    >
      <View style={styles.form}>
        {!available ? (
          <Card style={styles.note}>
            <Icon name="cloud" size={20} color={colors.textSecondary} />
            <Text variant="bodySm" color={colors.textSecondary} style={styles.flex}>
              {t('auth.unavailable')}
            </Text>
          </Card>
        ) : null}
        {guestItems > 0 && mode !== 'reset' ? (
          <Card style={styles.note}>
            <Icon name="cloud" size={20} color={colors.accentText} />
            <Text variant="bodySm" color={colors.textSecondary} style={styles.flex}>
              {t('auth.guestMerge', { count: guestItems })}
            </Text>
          </Card>
        ) : null}

        {sent ? (
          <Card style={styles.note} testID="reset-sent">
            <Icon name="check" size={20} color={colors.success} />
            <Text variant="body" style={styles.flex} accessibilityLiveRegion="polite">
              {t('auth.resetSent')}
            </Text>
          </Card>
        ) : null}

        <TextField
          testID="field-email"
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          maxLength={254}
        />
        {mode !== 'reset' ? (
          <TextField
            testID="field-password"
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            hint={mode === 'signUp' ? t('auth.passwordHint') : undefined}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
            maxLength={128}
            onSubmitEditing={() => void submit()}
          />
        ) : null}
        {errors.form ? (
          <Text variant="body" color={colors.danger} accessibilityLiveRegion="polite" testID="auth-error">
            {errors.form}
          </Text>
        ) : null}

        <Button
          testID="auth-submit"
          label={
            busy
              ? t('auth.working')
              : mode === 'signIn'
                ? t('auth.signIn')
                : mode === 'signUp'
                  ? t('auth.createAccount')
                  : t('auth.sendReset')
          }
          onPress={() => void submit()}
          disabled={busy || !available}
          fullWidth
        />

        <View style={styles.links}>
          {mode === 'signIn' ? (
            <>
              <Button
                label={t('auth.forgot')}
                variant="ghost"
                size="compact"
                onPress={() => router.replace('/reset-password')}
              />
              <Button
                label={t('auth.noAccount')}
                variant="ghost"
                size="compact"
                onPress={() => router.replace('/sign-up')}
              />
            </>
          ) : (
            <Button
              label={t('auth.haveAccount')}
              variant="ghost"
              size="compact"
              onPress={() => router.replace('/sign-in')}
            />
          )}
          <Button label={t('auth.continueGuest')} variant="ghost" size="compact" onPress={() => router.replace('/')} />
        </View>
      </View>
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sub: { marginTop: space.sm },
  form: { gap: space.md, paddingBottom: space.xxl },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  links: { alignItems: 'center', gap: space.xxs },
});
