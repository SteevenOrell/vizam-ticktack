import { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { recordRoutineRun } from '../../data/routines';
import type { DataContext } from '../../data/store';
import type { LocalDate } from '../../domain/localDate';
import {
  formatTimer,
  initialRun,
  runReducer,
  stepElapsedMs,
  stepRemainingMs,
  summarizeRun,
  type RunStep,
} from '../../domain/routineRun';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ProgressBar } from '../../ui/ProgressBar';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { fontFamilies } from '../../ui/theme/typography';

/**
 * Walks through a routine step by step. The state machine is `domain/routineRun` (time comes from event
 * timestamps, so a backgrounded screen cannot drift); this component only renders it, ticks once a second while
 * running, and records the run when it ends.
 */
export function RoutineRunner({
  ctx,
  routineId,
  title,
  steps,
  date,
  onClose,
}: {
  ctx: DataContext | null;
  routineId: string;
  title: string;
  steps: readonly RunStep[];
  date: LocalDate;
  /** Called after the run is closed (saved or abandoned with nothing done). */
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [run, dispatch] = useReducer(runReducer, steps, initialRun);
  const [tick, setTick] = useState(() => Date.now());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const recorded = useRef(false);

  useEffect(() => {
    dispatch({ type: 'start', now: Date.now() });
  }, []);

  useEffect(() => {
    if (run.status !== 'running') return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run.status]);

  const summary = summarizeRun(run);
  const finished = run.status === 'finished';

  const save = () => {
    if (!ctx) return;
    setSaveState('saving');
    recordRoutineRun(ctx, routineId, date, { completedStepIds: summary.completedStepIds }).then(
      () => setSaveState('saved'),
      (e) => {
        console.warn('Routine run save failed', e instanceof Error ? e.name : 'unknown');
        recorded.current = false;
        setSaveState('failed');
      },
    );
  };

  useEffect(() => {
    if (!finished || recorded.current) return;
    recorded.current = true;
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (finished) {
    const time = formatTimer(summary.elapsedMs);
    return (
      <View style={styles.stack} testID="routine-finished">
        <Text variant="title1" accessibilityRole="header" accessibilityLiveRegion="polite">
          {t('routines.finishedTitle')}
        </Text>
        <Card style={styles.card}>
          <Text variant="title3" testID="routine-finished-summary">
            {t('routines.finishedSummary', { done: summary.done, total: summary.total, time })}
          </Text>
          {summary.skipped > 0 ? (
            <Text variant="bodySm" color={colors.textSecondary}>
              {t('routines.finishedSkipped', { count: summary.skipped })}
            </Text>
          ) : null}
          {summary.open > 0 ? (
            <Text variant="bodySm" color={colors.textSecondary}>
              {t('routines.finishedOpen', { count: summary.open })}
            </Text>
          ) : null}
          {saveState === 'failed' ? (
            <Text variant="bodySm" color={colors.danger} accessibilityLiveRegion="polite" testID="routine-save-error">
              {t('routines.saveFailed')}
            </Text>
          ) : null}
        </Card>
        {saveState === 'failed' ? (
          <Button testID="routine-retry-save" label={t('states.retry')} variant="secondary" onPress={save} fullWidth />
        ) : null}
        <Button
          testID="routine-close-run"
          label={t('routines.closeRun')}
          onPress={onClose}
          disabled={saveState === 'saving'}
          fullWidth
        />
      </View>
    );
  }

  const step = run.steps[run.index];
  const now = run.status === 'running' ? Math.max(tick, run.runningSince ?? 0) : (run.runningSince ?? tick);
  const remaining = stepRemainingMs(run, now);
  const paused = run.status === 'paused';
  const timerText =
    remaining === null
      ? t('routines.timerUp', { time: formatTimer(stepElapsedMs(run, now)) })
      : remaining >= 0
        ? t('routines.timerLeft', { time: formatTimer(remaining) })
        : t('routines.timerOver', { time: formatTimer(remaining).replace('+', '') });
  const planned = step?.durationMin ? step.durationMin * 60_000 : null;
  const fraction = planned ? Math.min(1, stepElapsedMs(run, now) / planned) : 0;

  return (
    <View style={styles.stack} testID="routine-runner" accessibilityLabel={t('routines.runLabel', { title })}>
      <Text variant="caption" color={colors.textSecondary} accessibilityLiveRegion="polite" testID="routine-step-of">
        {t('routines.stepOf', { current: run.index + 1, total: run.steps.length })}
        {paused ? ` · ${t('routines.paused')}` : ''}
      </Text>
      <Text variant="title1" accessibilityRole="header" testID="routine-current-step">
        {step?.title}
      </Text>
      <Card style={styles.card}>
        <Text
          style={[styles.timer, { color: remaining !== null && remaining < 0 ? colors.danger : colors.text }]}
          accessibilityRole="timer"
          testID="routine-timer"
        >
          {timerText}
        </Text>
        {planned ? (
          <ProgressBar
            value={fraction}
            fill={colors.accent}
            track={colors.chip}
            height={8}
            accessibilityLabel={timerText}
          />
        ) : null}
      </Card>

      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            testID="routine-done"
            label={t('routines.stepDone')}
            icon="check"
            onPress={() => dispatch({ type: 'done', now: Date.now() })}
            fullWidth
          />
        </View>
        <View style={styles.flex}>
          <Button
            testID="routine-skip"
            label={t('routines.stepSkip')}
            variant="secondary"
            onPress={() => dispatch({ type: 'skip', now: Date.now() })}
            fullWidth
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            testID="routine-pause"
            label={paused ? t('routines.resume') : t('routines.pause')}
            variant="secondary"
            onPress={() => dispatch({ type: paused ? 'resume' : 'pause', now: Date.now() })}
            fullWidth
          />
        </View>
        <View style={styles.flex}>
          <Button
            testID="routine-back-step"
            label={t('routines.stepBack')}
            variant="secondary"
            onPress={() => dispatch({ type: 'back', now: Date.now() })}
            disabled={run.index === 0}
            fullWidth
          />
        </View>
      </View>
      <Button
        testID="routine-finish"
        label={t('routines.finishNow')}
        variant="ghost"
        onPress={() => dispatch({ type: 'finish', now: Date.now() })}
        fullWidth
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  card: { gap: space.sm, alignItems: 'stretch' },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 140 },
  timer: { fontFamily: fontFamilies.displayMedium, fontSize: 32, lineHeight: 38, fontVariant: ['tabular-nums'] },
});
