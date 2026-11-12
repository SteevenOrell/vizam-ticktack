import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button, type ButtonVariant } from './Button';
import { Text } from './Text';
import { radii, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';

export interface DialogAction {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  testID?: string;
}

/**
 * Modal confirmation with stacked actions (used for "This / Following / All" choices and destructive confirms).
 * RN Modal works on web too, unlike Alert.alert.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  actions,
  onCancel,
  cancelLabel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  actions: DialogAction[];
  onCancel: () => void;
  cancelLabel: string;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* Backdrop and card are siblings: no button inside a button (invalid HTML on web). */}
      <View style={styles.backdrop}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.dim]}
          onPress={onCancel}
          accessibilityLabel={cancelLabel}
          accessibilityRole="button"
        />
        <View
          style={[styles.card, { backgroundColor: colors.surface }]}
          accessibilityViewIsModal
          aria-modal
          testID="confirm-dialog"
        >
          <Text variant="title2" accessibilityRole="header">
            {title}
          </Text>
          {body ? (
            <Text variant="body" color={colors.textSecondary}>
              {body}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {actions.map((a) => (
              <Button
                key={a.label}
                label={a.label}
                variant={a.variant ?? 'secondary'}
                onPress={a.onPress}
                testID={a.testID}
                fullWidth
              />
            ))}
            <Button label={cancelLabel} variant="ghost" onPress={onCancel} fullWidth />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  card: { width: '100%', maxWidth: 420, borderRadius: radii.panel, padding: space.xl, gap: space.sm },
  actions: { gap: space.xs, marginTop: space.sm },
});
