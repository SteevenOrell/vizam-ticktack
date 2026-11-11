import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { DEFAULT_ITEM_REMINDER, REMINDER_OFFSETS, type ItemReminder } from '../../data/reminders';
import {
  getReminderPermission,
  openNotificationSettings,
  remindersSupported,
  requestReminderPermission,
  type ReminderPermission,
} from '../../services/notifications/expoNotifications';
import { usePreferences } from '../../state/preferences';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { Pill } from '../../ui/Pill';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { TimeOnlySelect, ToggleRow } from './RemindersEditor';

/**
 * The reminder of one task or routine: a switch, then either how long before the start time it rings (the item has
 * a start time) or the time of day it rings at (it has none). The first time it is switched on the permission is
 * explained before the system prompt; when denied the reminder stays saved and a banner links to the settings.
 */
export function ItemReminderField({
  value,
  onChange,
  timed,
}: {
  value: ItemReminder | null;
  onChange: (next: ItemReminder | null) => void;
  /** The item has a start time (relative reminder); otherwise the reminder rings at a time of day. */
  timed: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [permission, setPermission] = useState<ReminderPermission>(remindersSupported ? 'undetermined' : 'unavailable');
  const [explain, setExplain] = useState(false);
  const setRemindersUsed = usePreferences((s) => s.setRemindersUsed);
  const on = value !== null;

  useEffect(() => {
    if (!remindersSupported || !on) return;
    let cancelled = false;
    void getReminderPermission().then((p) => !cancelled && setPermission(p));
    return () => {
      cancelled = true;
    };
  }, [on]);

  const toggle = (next: boolean) => {
    onChange(next ? (value ?? DEFAULT_ITEM_REMINDER) : null);
    if (next && remindersSupported) {
      void getReminderPermission().then((p) => {
        setPermission(p);
        if (p === 'granted') setRemindersUsed(true);
        else if (p === 'undetermined') setExplain(true);
      });
    }
  };

  const allow = async () => {
    setExplain(false);
    const p = await requestReminderPermission();
    setPermission(p);
    if (p === 'granted') setRemindersUsed(true);
  };

  return (
    <View style={styles.wrap} testID="item-reminder">
      {!remindersSupported ? (
        <Card style={styles.note} testID="item-reminder-unavailable">
          <Icon name="bell" size={18} color={colors.textSecondary} />
          <Text variant="bodySm" color={colors.textSecondary} style={styles.flex}>
            {t('reminders.webUnavailable')}
          </Text>
        </Card>
      ) : null}
      {on && permission === 'denied' ? (
        <Card style={styles.note} testID="item-reminder-denied">
          <Icon name="alert" size={18} color={colors.danger} />
          <View style={styles.flex}>
            <Text variant="bodySm">{t('reminders.deniedBody')}</Text>
            <Button
              label={t('reminders.openSettings')}
              variant="ghost"
              size="compact"
              onPress={openNotificationSettings}
              testID="item-reminder-open-settings"
            />
          </View>
        </Card>
      ) : null}
      <ToggleRow
        testID="item-reminder-switch"
        title={t('reminders.itemTitle')}
        hint={timed ? t('reminders.itemHintTimed') : t('reminders.itemHintUntimed')}
        value={on}
        onChange={toggle}
        disabled={!remindersSupported}
      >
        {value && timed ? (
          <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={t('reminders.itemTitle')}>
            {REMINDER_OFFSETS.map((o) => (
              <Pill
                key={o}
                role="radio"
                label={t(`reminders.itemOffset_${o}` as never)}
                selected={value.offsetMin === o}
                onPress={() => onChange({ ...value, offsetMin: o })}
                testID={`item-reminder-offset-${o}`}
              />
            ))}
          </View>
        ) : null}
        {value && !timed ? (
          <TimeOnlySelect
            testID="item-reminder-time"
            label={t('reminders.at')}
            value={value.atTime}
            onChange={(atTime) => onChange({ ...value, atTime })}
          />
        ) : null}
      </ToggleRow>
      <ConfirmDialog
        visible={explain}
        title={t('reminders.primerTitle')}
        body={t('reminders.primerBody')}
        actions={[{ label: t('reminders.allow'), onPress: () => void allow(), testID: 'item-reminder-allow' }]}
        onCancel={() => setExplain(false)}
        cancelLabel={t('reminders.notNow')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  flex: { flex: 1, minWidth: 0 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
