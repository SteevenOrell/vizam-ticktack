import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radii, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useFocusRing } from './useFocusRing';

function StepButton({
  icon,
  label,
  onPress,
  disabled,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  return (
    <Pressable
      {...focusHandlers}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: colors.chip,
          borderColor: focused ? colors.focus : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Icon name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

/** "‹ value ›" control for dates and numbers. The value is announced with its label. */
export function Stepper({
  value,
  label,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  canPrevious = true,
  canNext = true,
  icons = 'chevrons',
  testID,
}: {
  value: string;
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel: string;
  nextLabel: string;
  canPrevious?: boolean;
  canNext?: boolean;
  icons?: 'chevrons' | 'plusMinus';
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} testID={testID}>
      <StepButton
        icon={icons === 'chevrons' ? 'chevronLeft' : 'minus'}
        label={previousLabel}
        onPress={onPrevious}
        disabled={!canPrevious}
        testID={testID ? `${testID}-prev` : undefined}
      />
      <View
        style={[styles.value, { backgroundColor: colors.surface }]}
        accessible
        accessibilityLabel={`${label}: ${value}`}
      >
        <Text variant="title3" align="center" style={styles.valueText}>
          {value}
        </Text>
      </View>
      <StepButton
        icon={icons === 'chevrons' ? 'chevronRight' : 'plus'}
        label={nextLabel}
        onPress={onNext}
        disabled={!canNext}
        testID={testID ? `${testID}-next` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  button: {
    width: sizes.touch,
    height: sizes.touch,
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    flex: 1,
    minHeight: sizes.touch,
    borderRadius: radii.input,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  valueText: { fontVariant: ['tabular-nums'] },
});
