import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import type { GoalPeriod } from '../../domain/goals';
import type { GoalReminders } from '../../domain/models';
import { timeOptions } from '../../domain/timeOptions';
import { weekdayNames } from '../../i18n/dates';
import { formatClock } from '../../lib/dates';
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
import { SelectField, type SelectOption } from '../../ui/SelectField';
import { Text } from '../../ui/Text';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

export const anyReminderOn = (r: GoalReminders, period: GoalPeriod) =>
  r.beforeDue.length > 0 ||
  r.eachStep ||
  r.monthlyDay !== null ||
  (r.periodic && (period === 'daily' || period === 'weekly'));

export function TimeOnlySelect({
  value,
  onChange,
  label,
  testID,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  testID: string;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const options = useMemo<SelectOption<string>[]>(
    () => timeOptions(value).map((v) => ({ value: v, label: formatClock(v, i18n.language) })),
    [i18n.language, value],
  );
  if (disabled) {
    return (
      <Text variant="bodySm" testID={testID}>
        {label}: {formatClock(value, i18n.language)}
      </Text>
    );
  }
  return (
    <SelectField
      testID={testID}
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      closeLabel={t('modal.close')}
      compact
    />
  );
}

export function ToggleRow({
  title,
  hint,
  value,
  onChange,
  disabled,
  testID,
  children,
}: {
  title: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.rowHead}>
        <View style={styles.flex}>
          <Text variant="body" weight={500}>
            {title}
          </Text>
          {hint ? (
            <Text variant="caption" color={colors.textSecondary}>
              {hint}
            </Text>
          ) : null}
        </View>
        <Switch
          testID={testID}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          accessibilityLabel={title}
          trackColor={{ false: colors.chip, true: colors.accent }}
          thumbColor={Platform.OS === 'android' ? (value ? colors.onAccent : colors.textSecondary) : undefined}
          ios_backgroundColor={colors.chip}
        />
      </View>
      {value && children ? <View style={styles.rowBody}>{children}</View> : null}
    </View>
  );
}

/**
 * Goal reminders (multi-select): before the due date, at each step, monthly check-in, and the daily / weekly
 * reminder of a daily / weekly goal. Turning the first one on explains reminders and only then shows the OS
 * permission prompt; when denied, reminders stay saved and a banner links to the system settings.
 */
export function RemindersEditor({
  value,
  onChange,
  period,
}: {
  value: GoalReminders;
  onChange: (next: GoalReminders) => void;
  period: GoalPeriod;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const lang = i18n.language;
  const [permission, setPermission] = useState<ReminderPermission>(remindersSupported ? 'undetermined' : 'unavailable');
  const [explain, setExplain] = useState(false);
  const setRemindersUsed = usePreferences((s) => s.setRemindersUsed);
  const disabled = !remindersSupported;
  const on = anyReminderOn(value, period);

  useEffect(() => {
    if (!remindersSupported || !on) return;
    let cancelled = false;
    void getReminderPermission().then((p) => !cancelled && setPermission(p));
    return () => {
      cancelled = true;
    };
  }, [on]);

  const set = (patch: Partial<GoalReminders>) => {
    const next = { ...value, ...patch };
    const turningOn = !on && anyReminderOn(next, period);
    onChange(next);
    if (turningOn && remindersSupported) {
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

  const toggleOffset = (o: 0 | 1 | 7) =>
    set({
      beforeDue: value.beforeDue.includes(o)
        ? value.beforeDue.filter((x) => x !== o)
        : ([...value.beforeDue, o].sort((a, b) => a - b) as GoalReminders['beforeDue']),
    });

  const days = useMemo<SelectOption<number>[]>(
    () => Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: t('goals.dayOfMonth', { day: i + 1 }) })),
    [t],
  );
  const names = weekdayNames(lang);

  return (
    <View style={styles.wrap} testID="reminders-editor">
      {disabled ? (
        <Card style={styles.note} testID="reminders-unavailable">
          <Icon name="bell" size={18} color={colors.textSecondary} />
          <Text variant="bodySm" color={colors.textSecondary} style={styles.flex}>
            {t('reminders.webUnavailable')}
          </Text>
        </Card>
      ) : null}
      {on && permission === 'denied' ? (
        <Card style={styles.note} testID="reminders-denied">
          <Icon name="alert" size={18} color={colors.danger} />
          <View style={styles.flex}>
            <Text variant="bodySm">{t('reminders.deniedBody')}</Text>
            <Button
              label={t('reminders.openSettings')}
              variant="ghost"
              size="compact"
              onPress={openNotificationSettings}
              testID="reminders-open-settings"
            />
          </View>
        </Card>
      ) : null}

      <ToggleRow
        testID="reminder-before-due"
        title={t('reminders.beforeDue')}
        hint={period === 'once' ? t('reminders.beforeDueHint') : t('reminders.beforeEndHint')}
        value={value.beforeDue.length > 0}
        onChange={(v) => set({ beforeDue: v ? [1] : [] })}
        disabled={disabled}
      >
        <View style={styles.pills} accessibilityLabel={t('reminders.beforeDue')}>
          {([0, 1, 7] as const).map((o) => (
            <Pill
              key={o}
              role="checkbox"
              label={t(`reminders.offset_${o}`)}
              selected={value.beforeDue.includes(o)}
              onPress={() => toggleOffset(o)}
              testID={`reminder-offset-${o}`}
            />
          ))}
        </View>
        <TimeOnlySelect
          testID="reminder-due-time"
          label={t('reminders.at')}
          value={value.beforeDueTime}
          onChange={(beforeDueTime) => set({ beforeDueTime })}
          disabled={disabled}
        />
      </ToggleRow>

      <ToggleRow
        testID="reminder-each-step"
        title={t('reminders.eachStep')}
        hint={t('reminders.eachStepHint')}
        value={value.eachStep}
        onChange={(eachStep) => set({ eachStep })}
        disabled={disabled}
      />

      <ToggleRow
        testID="reminder-monthly"
        title={t('reminders.monthly')}
        hint={t('reminders.monthlyHint')}
        value={value.monthlyDay !== null}
        onChange={(v) => set({ monthlyDay: v ? 1 : null })}
        disabled={disabled}
      >
        <View style={styles.pair}>
          <View style={styles.flex}>
            <SelectField
              testID="reminder-monthly-day"
              label={t('reminders.day')}
              value={value.monthlyDay ?? 1}
              options={days}
              onChange={(monthlyDay) => set({ monthlyDay })}
              closeLabel={t('modal.close')}
              compact
            />
          </View>
          <View style={styles.flex}>
            <TimeOnlySelect
              testID="reminder-monthly-time"
              label={t('reminders.at')}
              value={value.monthlyTime}
              onChange={(monthlyTime) => set({ monthlyTime })}
            />
          </View>
        </View>
      </ToggleRow>

      {period === 'daily' || period === 'weekly' ? (
        <ToggleRow
          testID="reminder-periodic"
          title={t(period === 'daily' ? 'reminders.daily' : 'reminders.weekly')}
          value={value.periodic}
          onChange={(periodic) => set({ periodic })}
          disabled={disabled}
        >
          {period === 'weekly' ? (
            <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={t('reminders.weekday')}>
              {names.map((name, i) => (
                <Pill
                  key={name}
                  role="radio"
                  label={name}
                  selected={value.periodicWeekday === i}
                  onPress={() => set({ periodicWeekday: i })}
                />
              ))}
            </View>
          ) : null}
          <TimeOnlySelect
            testID="reminder-periodic-time"
            label={t('reminders.at')}
            value={value.periodicTime}
            onChange={(periodicTime) => set({ periodicTime })}
          />
        </ToggleRow>
      ) : null}

      <ConfirmDialog
        visible={explain}
        title={t('reminders.primerTitle')}
        body={t('reminders.primerBody')}
        actions={[{ label: t('reminders.allow'), onPress: () => void allow(), testID: 'reminders-allow' }]}
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
  row: { borderRadius: radii.input, borderWidth: StyleSheet.hairlineWidth, padding: space.sm, gap: space.sm },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowBody: { gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  pair: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
});
