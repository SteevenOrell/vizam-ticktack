import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { categoryColors, type CategoryColor } from './theme/colors';
import { sizes } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useFocusRing } from './useFocusRing';

/** Round check (44 pt touch target). Done = orange fill with a charcoal tick; state is also announced, not colour only. */
export function Checkbox({
  checked,
  onChange,
  accessibilityLabel,
  testID,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  return (
    <Pressable
      {...focusHandlers}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      onPress={() => onChange(!checked)}
      style={[styles.hit, { borderColor: focused ? colors.focus : 'transparent' }]}
    >
      <View
        style={[
          styles.box,
          checked
            ? { backgroundColor: colors.accent, borderColor: colors.accent }
            : { backgroundColor: 'transparent', borderColor: colors.textSecondary },
        ]}
      >
        {checked ? <Icon name="check" size={16} color={colors.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

/** Small category colour dot (decorative; the category name is given in text or labels). */
export function CategoryDot({ color, size = 10, ring }: { color: CategoryColor | null; size?: number; ring?: string }) {
  if (!color) return null;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: categoryColors[color],
        borderWidth: ring ? 2 : 0,
        borderColor: ring,
      }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

const styles = StyleSheet.create({
  hit: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: sizes.touch / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
