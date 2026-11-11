/**
 * Horizontal swipe between pages (previous / next month, week or day) with a slide transition. The content follows
 * the finger; past a threshold (or a quick flick) it slides out, `onPage(dir)` swaps the content and the new page
 * slides in from the other side. Vertical scrolling keeps working: the pager only claims a drag that is clearly
 * horizontal, and only in the bubbling phase, so rows with their own swipe (SwipeRow) keep theirs.
 * Web: also ←/→ keys (when no input has focus); arrows stay the main control and go through `ref.go` for the same
 * transition.
 *
 * The slide-in waits for the new page: the old page leaves completely, the content is swapped while it is off screen,
 * and only when the parent renders a new `pageKey` (its data has loaded) does the new page enter. Moving the offset
 * before the new content was committed showed the old page again for a frame or two (the glitch on Android).
 */
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useHeaderScroll } from './HeaderScreen';

const DECIDE = 16;
const SWIPE_FRACTION = 0.22;
const FLICK_VELOCITY = 0.45;
/**
 * Safety net only, so the pager is never left busy: every change the calendar makes renders a new page key (or
 * unmounts the pager for the error state). Kept long on purpose: entering before the new page has loaded would bring
 * the old page back and swap it mid-slide, the very glitch this pager avoids (seen on a busy machine at 700 ms).
 */
export const ENTER_TIMEOUT_MS = 2000;
const nativeDriver = Platform.OS !== 'web';

interface PagerProps {
  onPage: (dir: -1 | 1) => void;
  enabled: boolean;
  width: number;
}

/** How the pager moves its offset; replaced by synchronous fakes in tests. */
export interface PagerMotion {
  slideOut: (x: Animated.Value, toValue: number, done: () => void) => void;
  slideIn: (x: Animated.Value, done: () => void) => void;
  settle: (x: Animated.Value) => void;
}

const animatedMotion: PagerMotion = {
  slideOut: (x, toValue, done) =>
    Animated.timing(x, { toValue, duration: 150, useNativeDriver: nativeDriver }).start(() => done()),
  slideIn: (x, done) =>
    Animated.spring(x, { toValue: 0, useNativeDriver: nativeDriver, speed: 22, bounciness: 0 }).start(() => done()),
  settle: (x) => Animated.spring(x, { toValue: 0, useNativeDriver: nativeDriver, bounciness: 0 }).start(),
};

/** Gesture state outside React render (same pattern as SwipeRow): animated offset, slide and pan responder. */
export function createPager(motion: PagerMotion = animatedMotion) {
  const x = new Animated.Value(0);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const state = {
    x,
    busy: false,
    /** Set between the content swap and the new page's first commit. */
    waiting: null as null | { dir: -1 | 1 },
    props: { onPage: () => undefined, enabled: true, width: 390 } as PagerProps,
    setProps(next: PagerProps) {
      state.props = next;
    },
    settle() {
      motion.settle(x);
    },
    /**
     * Slides the current page out towards `dir`, runs `change` (default `onPage(dir)`) while it is off screen, then
     * waits for `pageShown()` before the new page enters. A change requested mid-transition is applied at once.
     */
    slide(dir: -1 | 1, change: () => void = () => state.props.onPage(dir)) {
      if (state.busy) {
        change();
        return;
      }
      state.busy = true;
      // Next page (dir 1) leaves to the left and enters from the right.
      motion.slideOut(x, -dir * state.props.width, () => {
        state.waiting = { dir };
        change();
        timer = setTimeout(() => state.enter(), ENTER_TIMEOUT_MS);
      });
    },
    /** The parent committed a new page (called from a layout effect, before paint). */
    pageShown() {
      state.enter();
    },
    enter() {
      const waiting = state.waiting;
      if (!waiting) return;
      state.waiting = null;
      if (timer) clearTimeout(timer);
      timer = null;
      x.setValue(waiting.dir * state.props.width);
      motion.slideIn(x, () => {
        state.busy = false;
      });
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
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

export interface SwipePagerHandle {
  /** Same transition as a swipe; `change` defaults to `onPage(dir)` (arrows), or sets any date (Today). */
  go: (dir: -1 | 1, change?: () => void) => void;
}

export function SwipePager({
  onPage,
  children,
  testID,
  enabled = true,
  keyboard = true,
  accessibilityHint,
  pageKey,
  resetScroll = false,
  ref,
}: {
  onPage: (dir: -1 | 1) => void;
  children: ReactNode;
  testID?: string;
  enabled?: boolean;
  /** Listen to ←/→ on web (only one pager is on screen at a time). */
  keyboard?: boolean;
  accessibilityHint?: string;
  /** Identifies the page on screen; a new value means the new page's content is rendered. */
  pageKey: string;
  /** Jump the screen scroll to the top when the page changes (off for the hour grid, which scrolls itself). */
  resetScroll?: boolean;
  ref?: Ref<SwipePagerHandle>;
}) {
  const { width } = useWindowDimensions();
  const [pager] = useState(() => createPager());
  const { scrollToTop } = useHeaderScroll();
  useEffect(() => {
    pager.setProps({ onPage, enabled, width });
  }, [pager, onPage, enabled, width]);
  useEffect(() => () => pager.dispose(), [pager]);

  useImperativeHandle(ref, () => ({ go: (dir, change) => pager.slide(dir, change) }), [pager]);

  // New page committed: reset the scroll and start the slide-in before the frame is painted.
  const shownKey = useRef(pageKey);
  useLayoutEffect(() => {
    if (shownKey.current === pageKey) return;
    shownKey.current = pageKey;
    if (resetScroll) scrollToTop();
    pager.pageShown();
  }, [pageKey, resetScroll, scrollToTop, pager]);

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
