/**
 * Keyboard avoidance that works in Expo Go (react-native-keyboard-controller is not in Expo Go, see the Expo
 * "Keyboard handling" guide). Two pieces:
 *
 * - `KeyboardSafeView`: bottom padding equal to the part of the view the keyboard covers, measured in window
 *   coordinates (so it is right inside modals, page sheets and under a tab bar). Android apps are edge-to-edge, so
 *   the window no longer resizes for the keyboard; if a window does resize (some Android modals), the overlap is 0
 *   and nothing is added twice. Pinned footers (Save) inside it stay above the keyboard.
 * - `KeyboardAwareScrollView`: after the keyboard opens, or when a field gains focus while it is open, scrolls so
 *   the focused field (or a larger `RevealTarget`, e.g. a field with its suggestions) sits above the keyboard and
 *   above the scroll view's own bottom edge.
 *
 * Web: no virtual keyboard handling (the browser scrolls focused inputs into view).
 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  ScrollView,
  TextInput,
  View,
  type KeyboardEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
const SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
/** Space kept between the revealed field and the keyboard (or the scroll view's bottom edge). */
const MARGIN = 16;

type Measurable = ComponentRef<typeof View>;

/** Top of the keyboard in window coordinates, or null when it is closed. */
let keyboardTop: number | null = null;
if (native) {
  Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => {
    keyboardTop = e.endCoordinates.screenY;
  });
  Keyboard.addListener('keyboardDidHide', () => {
    keyboardTop = null;
  });
}
export const isKeyboardOpen = () => keyboardTop !== null;

function measure(node: Measurable | null): Promise<{ y: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== 'function') return resolve(null);
    node.measureInWindow((_x, y, _w, height) => resolve({ y, height }));
  });
}

interface Box {
  y: number;
  height: number;
}

/**
 * Padding a view needs so its content ends at the keyboard top (window coordinates). 0 when the keyboard does not
 * cover it, e.g. when the window itself already resized.
 */
export const keyboardOverlap = (view: Box, keyboardY: number) =>
  Math.max(0, Math.round(view.y + view.height - keyboardY));

/**
 * How far to scroll so `box` ends `margin` px above the keyboard and above the scroll frame's bottom edge. A box
 * taller than the visible area is aligned to the top instead. 0 = already visible.
 */
export function revealDelta(box: Box, frame: Box, keyboardY: number, margin = MARGIN): number {
  const visibleBottom = Math.min(keyboardY, frame.y + frame.height) - margin;
  const visibleTop = frame.y + margin;
  let delta = box.y + box.height - visibleBottom;
  if (delta > 0 && box.y - delta < visibleTop) delta = box.y - visibleTop;
  return delta > 1 ? delta : 0;
}

/** Pads its bottom by the keyboard overlap. Use as the root of a form screen or a sheet. */
export function KeyboardSafeView({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const ref = useRef<Measurable>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!native) return;
    const show = Keyboard.addListener(SHOW, (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY;
      ref.current?.measureInWindow((_x, y, _w, height) => {
        // The padding sits inside the view, so its outer bottom does not move when the inset changes.
        const overlap = keyboardOverlap({ y, height }, top);
        if (Platform.OS === 'ios' && e.duration) {
          LayoutAnimation.configureNext({
            duration: e.duration,
            update: { type: LayoutAnimation.Types.keyboard, duration: e.duration },
          });
        }
        setInset(overlap);
      });
    });
    const hide = Keyboard.addListener(HIDE, (e: KeyboardEvent) => {
      if (Platform.OS === 'ios' && e?.duration) {
        LayoutAnimation.configureNext({
          duration: e.duration,
          update: { type: LayoutAnimation.Types.keyboard, duration: e.duration },
        });
      }
      setInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View ref={ref} collapsable={false} style={[{ flex: 1 }, style, { paddingBottom: inset }]} testID={testID}>
      {children}
    </View>
  );
}

interface RevealApi {
  /** Scrolls `node` (or the focused input when omitted) above the keyboard, if the keyboard is open. */
  reveal: (node?: Measurable | null) => void;
}
const RevealCtx = createContext<RevealApi>({ reveal: () => undefined });
/** Inside a RevealTarget: the target's node, so a focused input reveals its whole group (field + suggestions). */
const TargetCtx = createContext<{ current: Measurable | null } | null>(null);

export function useKeyboardReveal() {
  const { reveal } = useContext(RevealCtx);
  const target = useContext(TargetCtx);
  return (node?: Measurable | null) => {
    // Wait a frame so the keyboard and any new content (suggestions) are laid out.
    setTimeout(() => reveal(target?.current ?? node ?? null), Platform.OS === 'android' ? 120 : 60);
  };
}

/** Groups content that must stay visible together while an input inside it has focus. */
export function RevealTarget({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<Measurable>(null);
  return (
    <TargetCtx.Provider value={ref}>
      <View ref={ref} collapsable={false} style={style}>
        {children}
      </View>
    </TargetCtx.Provider>
  );
}

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /** Style of the measured frame around the scroll view (default flex: 1; sheets use flexShrink: 1). */
  frameStyle?: StyleProp<ViewStyle>;
}

/** Inside a RevealTarget: reveals the group again when `token` changes while `active` (e.g. new suggestions). */
export function RevealWhen({ token, active }: { token: string | number; active: boolean }) {
  const reveal = useKeyboardReveal();
  useEffect(() => {
    if (active) reveal();
    // Only when the content or focus changes (reveal itself is a new function each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, active]);
  return null;
}

export const KeyboardAwareScrollView = forwardRef<ComponentRef<typeof ScrollView>, KeyboardAwareScrollViewProps>(
  function KeyboardAwareScrollView({ children, onScroll, scrollEventThrottle, frameStyle, ...rest }, forwarded) {
    const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
    const frameRef = useRef<Measurable>(null);
    const offset = useRef(0);
    // Created once: without deps the handle is detached and re-attached on every render, so a child's layout effect
    // (the calendar pager resetting the scroll on a page change) would find the parent's ref empty.
    useImperativeHandle(forwarded, () => scrollRef.current as ComponentRef<typeof ScrollView>, []);

    const reveal = useCallback(async (node?: Measurable | null) => {
      if (!native || keyboardTop === null) return;
      const focused = TextInput.State.currentlyFocusedInput() as unknown as Measurable | null;
      const [box, frame] = await Promise.all([measure(node ?? focused), measure(frameRef.current)]);
      if (!box || !frame || keyboardTop === null) return;
      const delta = revealDelta(box, frame, keyboardTop);
      if (delta) scrollRef.current?.scrollTo({ y: offset.current + delta, animated: true });
    }, []);

    useEffect(() => {
      if (!native) return;
      const sub = Keyboard.addListener('keyboardDidShow', () => setTimeout(() => void reveal(), 50));
      return () => sub.remove();
    }, [reveal]);

    const api = useMemo(() => ({ reveal: (n?: Measurable | null) => void reveal(n) }), [reveal]);

    return (
      <RevealCtx.Provider value={api}>
        <View ref={frameRef} collapsable={false} style={frameStyle ?? { flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
            scrollEventThrottle={scrollEventThrottle ?? 32}
            onScroll={(e) => {
              offset.current = e.nativeEvent.contentOffset.y;
              onScroll?.(e);
            }}
            {...rest}
          >
            {children}
          </ScrollView>
        </View>
      </RevealCtx.Provider>
    );
  },
);
