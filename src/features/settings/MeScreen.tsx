import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { pendingChangeCount } from '../../data/account';
import { useDatabase } from '../../data/DatabaseProvider';
import { shortTime } from '../../i18n/dates';
import { formatClock } from '../../lib/dates';
import { signOutFlow } from '../../services/accountFlows';
import { usePreferences, type LanguagePreference, type ThemePreference } from '../../state/preferences';
import { useSession, useSyncStatus } from '../../state/session';
import { retryFailed } from '../../sync/engine';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { HeaderScreen } from '../../ui/HeaderScreen';
import { Pill } from '../../ui/Pill';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { useFlowDeps, useServices } from '../session/SessionProvider';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text variant="label" color={colors.textSecondary} accessibilityRole="header">
        {title}
      </Text>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

function SyncLine() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const sync = useSyncStatus();
  const state =
    sync.state === 'syncing'
      ? t('me.syncSyncing')
      : sync.state === 'offline'
        ? t('me.syncOffline')
        : sync.state === 'error'
          ? t('me.syncError')
          : sync.lastSuccessAt
            ? t('me.syncDone', { time: shortTime(new Date(sync.lastSuccessAt), i18n.language) })
            : t('me.syncIdle');
  return (
    <View style={styles.kv} accessibilityLiveRegion="polite">
      <Text variant="body">{t('me.sync')}</Text>
      <Text
        variant="label"
        color={sync.state === 'error' ? colors.danger : colors.textSecondary}
        testID="sync-state"
        style={styles.flexShrink}
      >
        {state}
        {sync.pending > 0 ? ` · ${t('me.pending', { count: sync.pending })}` : ''}
      </Text>
    </View>
  );
}

export function MeScreen() {
  const { t, i18n } = useTranslation();
  const { colors, header } = useTheme();
  const router = useRouter();
  const prefs = usePreferences();
  const session = useSession();
  const sync = useSyncStatus();
  const database = useDatabase();
  const { gateway, syncNow } = useServices();
  const deps = useFlowDeps();
  const [confirmSignOut, setConfirmSignOut] = useState<null | number>(null);
  const [working, setWorking] = useState(false);
  const signedIn = session.status === 'signedIn';

  const themes: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: t('me.themeSystem') },
    { value: 'dark', label: t('me.themeDark') },
    { value: 'light', label: t('me.themeLight') },
  ];
  const languages: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t('me.languageSystem') },
    { value: 'en', label: t('me.languageEnglish') },
    { value: 'fr', label: t('me.languageFrench') },
  ];

  const askSignOut = async () => {
    const pending = database.status === 'ready' ? await pendingChangeCount(database.db) : 0;
    setConfirmSignOut(pending);
  };
  const doSignOut = async () => {
    setConfirmSignOut(null);
    if (!deps) return;
    setWorking(true);
    useSession.getState().setBusy(true);
    try {
      await signOutFlow(deps);
      useSession.getState().setGuest();
    } finally {
      useSession.getState().setBusy(false);
      setWorking(false);
    }
  };

  return (
    <HeaderScreen
      testID="screen-me"
      title={t('me.title')}
      header={
        <View style={styles.account}>
          <Text variant="title3" color={header.on.text}>
            {signedIn ? t('me.signedInTitle') : t('me.guestTitle')}
          </Text>
          <Text variant="bodySm" color={header.on.textSecondary} numberOfLines={signedIn ? 1 : undefined}>
            {signedIn ? (session.email ?? '') : t('me.guestBody')}
          </Text>
        </View>
      }
    >
      <Section title={t('me.account')}>
        {signedIn ? (
          <>
            <SyncLine />
            <View style={styles.buttons}>
              <Button
                label={t('me.syncNow')}
                variant="secondary"
                size="compact"
                icon="refresh"
                onPress={() => void syncNow()}
                disabled={sync.state === 'syncing'}
              />
              {sync.failed > 0 && database.status === 'ready' ? (
                <Button
                  label={t('me.retryFailed', { count: sync.failed })}
                  variant="secondary"
                  size="compact"
                  onPress={() => void retryFailed(database.db).then(() => syncNow())}
                />
              ) : null}
            </View>
            <Button
              label={t('me.signOut')}
              variant="secondary"
              onPress={() => void askSignOut()}
              disabled={working}
              fullWidth
              testID="sign-out"
            />
            <Button
              label={t('me.deleteAccount')}
              variant="destructive"
              icon="trash"
              onPress={() => router.push('/account/delete')}
              fullWidth
            />
          </>
        ) : (
          <>
            <Text variant="bodySm" color={colors.textSecondary}>
              {gateway ? t('me.guestAccountBody') : t('auth.unavailable')}
            </Text>
            <Button
              label={t('me.createAccount')}
              onPress={() => router.push('/sign-up')}
              disabled={!gateway}
              fullWidth
              testID="me-sign-up"
            />
            <Button
              label={t('me.signIn')}
              variant="secondary"
              onPress={() => router.push('/sign-in')}
              disabled={!gateway}
              fullWidth
            />
          </>
        )}
      </Section>

      <Section title={t('me.appearance')}>
        <Text variant="title3">{t('me.theme')}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('me.theme')} style={styles.pills}>
          {themes.map((o) => (
            <Pill
              key={o.value}
              label={o.label}
              selected={prefs.theme === o.value}
              onPress={() => prefs.setTheme(o.value)}
            />
          ))}
        </View>
        <Text variant="title3">{t('me.language')}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('me.language')} style={styles.pills}>
          {languages.map((o) => (
            <Pill
              key={o.value}
              label={o.label}
              selected={prefs.language === o.value}
              onPress={() => prefs.setLanguage(o.value)}
            />
          ))}
        </View>
      </Section>

      <Section title={t('me.planning')}>
        <View style={styles.kv}>
          <Text variant="body">{t('me.dayStarts')}</Text>
          <Text variant="title3">{formatClock(prefs.dayStart, i18n.language)}</Text>
        </View>
        <View style={styles.kv}>
          <Text variant="body">{t('me.dayEnds')}</Text>
          <Text variant="title3">{formatClock(prefs.dayEnd, i18n.language)}</Text>
        </View>
      </Section>

      <Section title={t('me.about')}>
        <Text variant="title3">{t('app.concept')}</Text>
        <Text variant="bodySm" color={colors.textSecondary}>
          {t('me.conceptNote')}
        </Text>
        <Text variant="caption" color={colors.textTertiary}>
          {t('me.version', { version: Constants.expoConfig?.version ?? '0.0.0' })}
        </Text>
      </Section>

      <ConfirmDialog
        visible={confirmSignOut !== null}
        title={t('me.signOutTitle')}
        body={confirmSignOut ? t('me.signOutPending', { count: confirmSignOut }) : t('me.signOutBody')}
        actions={[
          {
            label: t('me.signOut'),
            variant: 'destructive',
            onPress: () => void doSignOut(),
            testID: 'confirm-sign-out',
          },
        ]}
        onCancel={() => setConfirmSignOut(null)}
        cancelLabel={t('editor.cancel')}
      />
    </HeaderScreen>
  );
}

const styles = StyleSheet.create({
  account: { marginTop: space.md, gap: space.xxs },
  section: { gap: space.xs, marginBottom: space.xl },
  card: { gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, minHeight: 32 },
  flexShrink: { flexShrink: 1, textAlign: 'right' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
