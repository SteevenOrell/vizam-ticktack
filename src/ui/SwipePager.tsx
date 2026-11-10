/**
 * Horizontal swipe between pages (previous / next month, week or day) with a slide transition. The content follows
 * the finger; past a threshold (or a quick flick) it slides out, `onPage(dir)` swaps the content and the new page
 * slides in from the other side. Vertical scrolling keeps working: the pager only claims a drag that is clearly
 * horizontal, and only in the bubbling phase, so rows with their own swipe (SwipeRow) keep theirs.
 * Web: also ←/→ keys (when no input has focus); arrows stay the main control.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

const DECIDE = 16;
const SWIPE_FRACTION = 0.22;
const FLICK_VELOCITY = 0.45;
const nativeDriver = Platform.OS !== 'web';

interface PagerProps {
  onPage: (dir: -1 | 1) => void;
  enabled: boolean;
  width: number;
}

/** Gesture state outside React render (same pattern as SwipeRow): animated offset, slide and pan responder. */
function createPager() {
  const x = new Animated.Value(0);
  const state = {
    x,
    busy: false,
    props: { onPage: () => undefined, enabled: true, width: 390 } as PagerProps,
    setProps(next: PagerProps) {
      state.props = next;
    },
    settle() {
      Animated.spring(x, { toValue: 0, useNativeDriver: nativeDriver, bounciness: 0 }).start();
    },
    slide(dir: -1 | 1) {
      if (state.busy) return;
      state.busy = true;
      const w = state.props.width;
      // Next page (dir 1) leaves to the left and enters from the right.
      Animated.timing(x, { toValue: -dir * w, duration: 150, useNativeDriver: nativeDriver }).start(() => {
        state.props.onPage(dir);
        x.setValue(dir * w * 0.6);
        Animated.spring(x, { toValue: 0, useNativeDriver: nativeDriver, speed: 22, bounciness: 0 }).start(() => {
          state.busy = false;
        });
      });
    },
    responder: null as unknown as ReturnType<typeof PanResponder.create>,
  };
  state.responder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      state.props.enabled && !state.busy && Math.abs(g.dx) > DECIDE && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => x.setValue(g.dx),
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) > state.props.width * SWIPE_FRACTION || Math.abs(g.vx) > FLICK_VELOCITY) {
        state.slide(g.dx < 0 ? 1 : -1);
      } else {
        state.settle();
      }
    },
    onPanResponderTerminate: () => state.settle(),
  });
  return state;
}

export function SwipePager({
  onPage,
  children,
  testID,
  enabled = true,
  keyboard = true,
  accessibilityHint,
}: {
  onPage: (dir: -1 | 1) => void;
  children: ReactNode;
  testID?: string;
  enabled?: boolean;
  /** Listen to ←/→ on web (only one pager is on screen at a time). */
  keyboard?: boolean;
  accessibilityHint?: string;
}) {
  const { width } = useWindowDimensions();
  const [pager] = useState(createPager);
  useEffect(() => {
    pager.setProps({ onPage, enabled, width });
  }, [pager, onPage, enabled, width]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !keyboard || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      // Leave arrows to text fields, tab lists, radio groups and open dialogs.
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
      const role = el?.getAttribute?.('role');
      if (role === 'tab' || role === 'radio' || role === 'slider' || document.querySelector('[aria-modal="true"]')) {
        return;
      }
      if (!pager.props.enabled) return;
      e.preventDefault();
      pager.slide(e.key === 'ArrowRight' ? 1 : -1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [keyboard, pager]);

  return (
    <View style={styles.clip} testID={testID} accessibilityHint={accessibilityHint}>
      <Animated.View style={{ transform: [{ translateX: pager.x }] }} {...pager.responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
