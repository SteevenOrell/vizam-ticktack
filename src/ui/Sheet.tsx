import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { Text } from './Text';
import { radii, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';

/**
 * Bottom sheet (phones) / centred panel (wide web) on a dimmed backdrop. Tapping the backdrop, the close button,
 * Android back or Escape on web closes it. RN Modal, so it also works on web.
 */
export function Sheet({
  visible,
  title,
  onClose,
  closeLabel,
  children,
  testID,
  footer,
  scroll,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  testID?: string;
  /** Pinned under the content (actions). */
  footer?: ReactNode;
  /** Wrap the content in a scroll view (forms). Leave off when the content is itself a list. */
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= 700;
  return (
    <Modal visible={visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.root, wide ? styles.rootWide : null]}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={onClose}
          accessibilityLabel={closeLabel}
          accessibilityRole="button"
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.panel,
            wide ? styles.panelWide : { paddingBottom: insets.bottom + space.md },
            { backgroundColor: colors.surface, maxHeight: Math.max(320, height * (wide ? 0.8 : 0.86)) },
          ]}
        >
          {wide ? null : <View style={[styles.grabber, { backgroundColor: colors.border }]} />}
          <View style={styles.head}>
            <Text variant="title2" accessibilityRole="header" style={styles.flex} numberOfLines={2}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              style={styles.close}
              hitSlop={4}
            >
              <Icon name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          {scroll ? (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.body, styles.scroll]}>{children}</View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  rootWide: { justifyContent: 'center', alignItems: 'center', padding: space.lg },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  flex: { flex: 1 },
  panel: {
    width: '100%',
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    paddingTop: space.xs,
  },
  panelWide: { maxWidth: 520, borderRadius: radii.panel, paddingBottom: space.lg },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: space.xs },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingBottom: space.xs,
  },
  close: { width: sizes.touch, height: sizes.touch, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexShrink: 1 },
  body: { paddingHorizontal: space.lg },
  footer: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.xs },
});
