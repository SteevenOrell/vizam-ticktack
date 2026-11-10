import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ScrollView, StyleSheet, View, type RefreshControlProps } from 'react-native';

import { DeckPanel } from './Card';
import { GradientHeader } from './GradientHeader';
import { KeyboardAwareScrollView, KeyboardSafeView } from './keyboard';
import { Text } from './Text';
import { space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';

interface HeaderScroll {
  /** Scrolls the screen so that `y` px inside `node` lands `margin` px below the top of the viewport. */
  scrollToIn: (node: ComponentRef<typeof View> | null, y: number, margin?: number) => void;
}

const ScrollCtx = createContext<HeaderScroll>({ scrollToIn: () => undefined });
export const useHeaderScroll = () => useContext(ScrollCtx);

/**
 * Screen layout: gradient header (title, optional action, extra header content) with a deck panel below. The whole
 * screen is one vertical scroll view; content must not nest another vertical scroller (it would trap the gesture
 * on phones), so long content such as the day timeline grows inside this scroll and uses `useHeaderScroll`.
 * Forms (sign-in, sign-up, reset) stay usable with the keyboard open: the screen pads above it and scrolls the
 * focused field into view.
 */
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
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const contentRef = useRef<ComponentRef<typeof View>>(null);

  const scrollToIn = useCallback((node: ComponentRef<typeof View> | null, y: number, margin: number = space.lg) => {
    const content = contentRef.current;
    if (!node || !content) return;
    node.measureLayout(
      content,
      (_x, top) => scrollRef.current?.scrollTo({ y: Math.max(0, top + y - margin), animated: false }),
      () => undefined,
    );
  }, []);
  const scroll = useMemo(() => ({ scrollToIn }), [scrollToIn]);

  return (
    <KeyboardSafeView testID={testID} style={{ backgroundColor: theme.colors.bg }}>
      <ScrollCtx.Provider value={scroll}>
        <KeyboardAwareScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          bounces={!!refreshControl}
          refreshControl={refreshControl}
          testID={testID ? `${testID}-scroll` : undefined}
        >
          <View ref={contentRef} collapsable={false} style={styles.flexGrow}>
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
          </View>
        </KeyboardAwareScrollView>
      </ScrollCtx.Provider>
      {footer}
    </KeyboardSafeView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1 },
  // Room under the last row for the floating action button and the undo bar.
  scroll: { flexGrow: 1, paddingBottom: space.huge + space.xxl },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  title: { flexShrink: 1 },
});
