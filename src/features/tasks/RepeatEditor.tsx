import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { RepeatDraft } from '../../data/tasks';
import { dayLabel, shortDate, weekdayNames } from '../../i18n/dates';
import { addDays, addMonthsClamped, parseYmd, weekdayOf, type LocalDate } from '../../domain/localDate';
import { nextOccurrences } from '../../domain/recurrence/generator';
import { noonOf } from '../../lib/dates';
import { Pill } from '../../ui/Pill';
import { Stepper } from '../../ui/Stepper';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

type Freq = RepeatDraft['freq'] | 'never';

export function defaultRepeat(freq: RepeatDraft['freq'], date: LocalDate, weekStartsOn: 0 | 1 | 6): RepeatDraft {
  return {
    freq,
    interval: 1,
    byWeekday: freq === 'weekly' ? [weekdayOf(date)] : null,
    byMonthDay: freq === 'monthly' ? parseYmd(date).d : null,
    weekStartsOn,
    endType: 'never',
    endDate: null,
    count: null,
  };
}

/**
 * Recurrence settings (DESIGN.md section 7.7): frequency, "every n", weekdays (weekly), day of month (monthly),
 * end (never / on date / after n), and a live preview of the next dates.
 */
export function RepeatEditor({
  value,
  onChange,
  startDate,
  weekStartsOn,
  error,
}: {
  value: RepeatDraft | null;
  onChange: (value: RepeatDraft | null) => void;
  startDate: LocalDate | null;
  weekStartsOn: 0 | 1 | 6;
  error?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const lang = i18n.language;
  const names = weekdayNames(lang);
  const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
  const base = startDate ?? null;

  const preview = useMemo(() => {
    if (!value || !base) return [];
    try {
      return nextOccurrences({ ...value, startDate: base }, base, 3);
    } catch {
      return [];
    }
  }, [value, base]);

  const setFreq = (freq: Freq) => {
    if (freq === 'never' || !base) onChange(null);
    else onChange(defaultRepeat(freq, base, weekStartsOn));
  };
  const freqs: { value: Freq; label: string }[] = [
    { value: 'never', label: t('repeat.never') },
    { value: 'daily', label: t('repeat.daily') },
    { value: 'weekly', label: t('repeat.weekly') },
    { value: 'monthly', label: t('repeat.monthly') },
  ];
  const unit =
    value?.freq === 'weekly'
      ? t('repeat.weeks', { count: value.interval })
      : value?.freq === 'monthly'
        ? t('repeat.months', { count: value.interval })
        : t('repeat.days', { count: value?.interval ?? 1 });

  return (
    <View style={styles.wrap} testID="repeat-editor">
      <View accessibilityRole="radiogroup" accessibilityLabel={t('repeat.title')} style={styles.pills}>
        {freqs.map((f) => (
          <Pill
            key={f.value}
            label={f.label}
            selected={(value?.freq ?? 'never') === f.value}
            onPress={() => setFreq(f.value)}
          />
        ))}
      </View>
      {!base && value === null ? (
        <Text variant="caption" color={colors.textSecondary}>
          {t('repeat.needsDate')}
        </Text>
      ) : null}

      {value ? (
        <>
          <Text variant="label" color={colors.textSecondary}>
            {t('repeat.every')}
          </Text>
          <Stepper
            testID="repeat-interval"
            icons="plusMinus"
            label={t('repeat.every')}
            value={`${value.interval} ${unit}`}
            previousLabel={t('repeat.less')}
            nextLabel={t('repeat.more')}
            canPrevious={value.interval > 1}
            canNext={value.interval < 99}
            onPrevious={() => onChange({ ...value, interval: Math.max(1, value.interval - 1) })}
            onNext={() => onChange({ ...value, interval: Math.min(99, value.interval + 1) })}
          />

          {value.freq === 'weekly' ? (
            <View accessibilityLabel={t('repeat.onDays')} style={styles.pills}>
              {order.map((wd) => {
                const selected = value.byWeekday?.includes(wd) ?? false;
                return (
                  <Pill
                    key={wd}
                    label={names[wd] ?? String(wd)}
                    selected={selected}
                    role="checkbox"
                    onPress={() => {
                      const set = new Set(value.byWeekday ?? []);
                      if (selected) set.delete(wd);
                      else set.add(wd);
                      onChange({ ...value, byWeekday: [...set].sort((a, b) => a - b) });
                    }}
                  />
                );
              })}
            </View>
          ) : null}

          {value.freq === 'monthly' ? (
            <Stepper
              testID="repeat-monthday"
              icons="plusMinus"
              label={t('repeat.onMonthDay')}
              value={t('repeat.monthDay', { day: value.byMonthDay ?? 1 })}
              previousLabel={t('repeat.less')}
              nextLabel={t('repeat.more')}
              canPrevious={(value.byMonthDay ?? 1) > 1}
              canNext={(value.byMonthDay ?? 1) < 31}
              onPrevious={() => onChange({ ...value, byMonthDay: Math.max(1, (value.byMonthDay ?? 1) - 1) })}
              onNext={() => onChange({ ...value, byMonthDay: Math.min(31, (value.byMonthDay ?? 1) + 1) })}
            />
          ) : null}

          <Text variant="label" color={colors.textSecondary}>
            {t('repeat.ends')}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('repeat.ends')} style={styles.pills}>
            <Pill
              label={t('repeat.endNever')}
              selected={value.endType === 'never'}
              onPress={() => onChange({ ...value, endType: 'never', endDate: null, count: null })}
            />
            <Pill
              label={t('repeat.endOnDate')}
              selected={value.endType === 'onDate'}
              onPress={() =>
                onChange({
                  ...value,
                  endType: 'onDate',
                  endDate: value.endDate ?? addMonthsClamped(base ?? '2026-01-01', 1),
                  count: null,
                })
              }
            />
            <Pill
              label={t('repeat.endAfter')}
              selected={value.endType === 'afterCount'}
              onPress={() => onChange({ ...value, endType: 'afterCount', count: value.count ?? 10, endDate: null })}
            />
          </View>
          {value.endType === 'onDate' && value.endDate ? (
            <Stepper
              testID="repeat-enddate"
              label={t('repeat.endOnDate')}
              value={shortDate(noonOf(value.endDate), lang)}
              previousLabel={t('dates.previousDay')}
              nextLabel={t('dates.nextDay')}
              canPrevious={!base || value.endDate > base}
              onPrevious={() => onChange({ ...value, endDate: addDays(value.endDate as string, -1) })}
              onNext={() => onChange({ ...value, endDate: addDays(value.endDate as string, 1) })}
            />
          ) : null}
          {value.endType === 'afterCount' ? (
            <Stepper
              testID="repeat-count"
              icons="plusMinus"
              label={t('repeat.endAfter')}
              value={t('repeat.times', { count: value.count ?? 1 })}
              previousLabel={t('repeat.less')}
              nextLabel={t('repeat.more')}
              canPrevious={(value.count ?? 1) > 1}
              canNext={(value.count ?? 1) < 999}
              onPrevious={() => onChange({ ...value, count: Math.max(1, (value.count ?? 1) - 1) })}
              onNext={() => onChange({ ...value, count: Math.min(999, (value.count ?? 1) + 1) })}
            />
          ) : null}

          <Text variant="bodySm" color={colors.textSecondary} accessibilityLiveRegion="polite" testID="repeat-preview">
            {preview.length
              ? t('repeat.preview', { dates: preview.map((d) => dayLabel(noonOf(d), lang)).join(', ') })
              : t('repeat.previewNone')}
          </Text>
        </>
      ) : null}
      {error ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
