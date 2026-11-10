import { StyleSheet, View } from 'react-native';

import { radii } from './theme/layout';

export interface ProgressBarProps {
  /** 0..1; values above 1 render full (over-planned) */
  value: number;
  fill: string;
  track: string;
  accessibilityLabel: string;
  height?: number;
}

export function ProgressBar({ value, fill, track, accessibilityLabel, height = 8 }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { backgroundColor: track, height }]}
    >
      <View style={[styles.fill, { backgroundColor: fill, width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: radii.pill, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: radii.pill },
});
