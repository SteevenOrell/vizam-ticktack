import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { decorativeProps } from './platform';

/** Circular progress (DESIGN.md "ProgressArc"): accent arc on a muted track, content (the % numeral) centred. */
export function ProgressArc({
  value,
  size = 132,
  stroke = 10,
  fill,
  track,
  accessibilityLabel,
  children,
  testID,
}: {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  fill: string;
  track: string;
  accessibilityLabel: string;
  children?: ReactNode;
  testID?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{ width: size, height: size }}
      testID={testID}
    >
      <Svg width={size} height={size} {...decorativeProps}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {clamped > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={fill}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - clamped)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
