import { StyleSheet, View, type ViewProps } from 'react-native';

import { radii, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';

/** Rounded card. Dark theme gets depth from surface steps; light theme adds a soft shadow (DESIGN.md section 5). */
export function Card({ style, ...rest }: ViewProps) {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface }, scheme === 'light' ? styles.shadow : null, style]}
      {...rest}
    />
  );
}

/** Rounded panel stacked over the header; overlaps the previous layer by 24 px. */
export function DeckPanel({ style, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return <View style={[styles.panel, { backgroundColor: colors.bg }, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.card, padding: space.md },
  shadow: {
    boxShadow: '0px 6px 20px rgba(0, 0, 0, 0.08)',
  },
  panel: {
    flex: 1,
    marginTop: -sizes.deckOverlap,
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    paddingTop: space.xl,
    paddingHorizontal: space.lg,
  },
});
