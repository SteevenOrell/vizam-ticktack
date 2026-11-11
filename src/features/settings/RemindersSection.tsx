import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { ExactAlarmState } from '../../services/notifications/exactAlarm';
import {
  getExactAlarmState,
  getReminderPermission,
  openNotificationSettings,
  remindersSupported,
  requestExactAlarm,
  type ReminderPermission,
} from '../../services/notifications/expoNotifications';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

/**
 * Me > Reminders: whether notifications are allowed and, on Android, whether reminders ring at the exact minute.
 * Denied notifications and missing exact-alarm access each get a button that opens the matching system screen
 * ("Alarms & reminders" for exact alarms, after an in-app explanation).
 */
export function RemindersSection() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [permission, setPermission] = useState<ReminderPermission>(remindersSupported ? 'undetermined' : 'unavailable');
  const [exact, setExact] = useState<ExactAlarmState>('notNeeded');
  const [explain, setExplain] = useState(false);

  const refresh = useCallback(async () => {
    if (!remindersSupported) return;
    const [p, e] = await Promise.all([getReminderPermission(), getExactAlarmState()]);
    setPermission(p);
    setExact(e);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allowExact = async () => {
    setExplain(false);
    setExact(await requestExactAlarm());
  };

  const status = !remindersSupported
    ? t('reminders.webUnavailable')
    : permission === 'denied'
      ? t('reminders.deniedBody')
      : permission === 'granted'
        ? exact === 'askable' || exact === 'unavailable'
          ? t('reminders.exactNote')
          : t('settings.remindersOk')
        : t('settings.remindersNotAsked');

  return (
    <View style={styles.wrap} testID="settings-reminders">
      <Text
        variant="bodySm"
        color={colors.textSecondary}
        accessibilityLiveRegion="polite"
        testID="settings-reminders-status"
      >
        {status}
      </Text>
      {remindersSupported && permission === 'denied' ? (
        <Button
          label={t('reminders.openSettings')}
          variant="secondary"
          size="compact"
          onPress={openNotificationSettings}
          testID="settings-reminders-open"
        />
      ) : null}
      {remindersSupported && permission === 'granted' && exact === 'askable' ? (
        <Button
          label={t('reminders.exactButton')}
          variant="secondary"
          size="compact"
          onPress={() => setExplain(true)}
          testID="settings-reminders-exact"
        />
      ) : null}
      <ConfirmDialog
        visible={explain}
        title={t('reminders.exactTitle')}
        body={t('reminders.exactBody')}
        actions={[
          { label: t('reminders.exactAllow'), onPress: () => void allowExact(), testID: 'settings-exact-allow' },
        ]}
        onCancel={() => setExplain(false)}
        cancelLabel={t('reminders.notNow')}
      />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: space.sm } });
