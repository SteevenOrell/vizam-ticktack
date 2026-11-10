import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { radii, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useFocusRing } from './useFocusRing';

export interface Segment<T extends string> {
  value: T;
  label: string;
}

function SegmentButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { header, colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  return (
    <Pressable
      {...focusHandlers}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.segment,
        {
          backgroundColor: selected ? header.on.selectedBg : 'transparent',
          borderColor: focused ? colors.focus : 'transparent',
        },
      ]}
    >
      <Text
        variant="label"
        weight={selected ? 600 : 500}
        color={selected ? header.on.selectedFg : header.on.unselectedFg}
        align="center"
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Segmented control for header use (Day / Week / Month). Selected = charcoal with orange on day headers. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  accessibilityLabel,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const { header } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, { backgroundColor: header.on.trackBg }]}
    >
      {segments.map((s) => (
        <SegmentButton key={s.value} label={s.label} selected={s.value === value} onPress={() => onChange(s.value)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: radii.pill, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: sizes.touch - 4,
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
});
