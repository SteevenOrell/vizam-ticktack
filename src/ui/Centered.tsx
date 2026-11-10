import { StyleSheet, useWindowDimensions, View, type ViewProps } from 'react-native';

import { contentWidth, space, WIDE_BREAKPOINT } from './theme/layout';

/** True from tablet width up (768 pt): the week view becomes an hour grid. */
export function useWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}

/**
 * Distance from the window edge to the centred content column, plus `inset`. Floating controls (the "+" button)
 * use it so they stay with the column on a wide screen instead of sitting in the far corner.
 */
export function useColumnInset(inset: number = space.lg, maxWidth: number = contentWidth.text): number {
  const { width } = useWindowDimensions();
  return Math.max(0, (width - maxWidth) / 2) + inset;
}

/**
 * Centres its children in a column of at most `maxWidth` (720 by default). On a phone it is a plain full-width
 * view; on tablet and desktop the content stops growing and the background of the parent shows on both sides.
 */
export function Centered({ maxWidth = contentWidth.text, style, ...rest }: ViewProps & { maxWidth?: number }) {
  return <View style={[styles.column, { maxWidth }, style]} {...rest} />;
}

/** The same column as a style, for a container that owns its horizontal padding (bars, scroll content, footers). */
export const columnStyle = {
  width: '100%',
  maxWidth: contentWidth.text + 2 * space.lg,
  alignSelf: 'center',
} as const;

/** Column style for content inside an already padded parent. */
export const innerColumnStyle = { width: '100%', maxWidth: contentWidth.text, alignSelf: 'center' } as const;

const styles = StyleSheet.create({ column: { width: '100%', alignSelf: 'center' } });
