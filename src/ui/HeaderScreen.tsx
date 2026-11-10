import type { ReactElement, ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type RefreshControlProps } from 'react-native';

import { DeckPanel } from './Card';
import { GradientHeader } from './GradientHeader';
import { Text } from './Text';
import { space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';

/** Screen layout: gradient header (title, optional action, extra header content) with a deck panel below. */
export function HeaderScreen({
  title,
  action,
  header,
  children,
  testID,
  refreshControl,
  footer,
}: {
  title: string;
  action?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  testID?: string;
  /** Pull to refresh (sync). */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Content after the deck panel, outside the scroll view (floating actions). */
  footer?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.flex, { backgroundColor: theme.colors.bg }]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        bounces={!!refreshControl}
        refreshControl={refreshControl}
      >
        <GradientHeader>
          <View style={styles.titleRow}>
            <Text variant="title1" color={theme.header.on.text} accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {action}
          </View>
          {header}
        </GradientHeader>
        <DeckPanel>{children}</DeckPanel>
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: space.xxl },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  title: { flexShrink: 1 },
});
