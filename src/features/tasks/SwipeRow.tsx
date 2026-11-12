import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { charcoal, white } from '../../ui/theme/colors';
import { radii, space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';

const ACTION_W = 76;
const OPEN_X = -ACTION_W * 2;
const COMPLETE_AT = 96;

type Side = 'none' | 'left' | 'right';

/** Gesture state outside React render: animated offset, settle animation and the pan responder. */
function createSwipe(setSide: (side: Side) => void) {
  const x = new Animated.Value(0);
  const state = {
    x,
    offset: 0,
    props: { enabled: true, canReveal: true, onComplete: () => undefined as void },
    setProps(next: { enabled: boolean; canReveal: boolean; onComplete: () => void }) {
      state.props = next;
    },
    settle(to: number) {
      state.offset = to;
      Animated.spring(x, { toValue: to, useNativeDriver: false, bounciness: 0, speed: 20 }).start(() => {
        if (to === 0) setSide('none');
      });
    },
    responder: null as unknown as ReturnType<typeof PanResponder.create>,
  };
  const horizontal = (g: { dx: number; dy: number }) =>
    state.props.enabled && Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
  state.responder = PanResponder.create({
    // Capture phase: the row takes the gesture from the pressables inside it once the drag is clearly horizontal.
    onMoveShouldSetPanResponderCapture: (_, g) => horizontal(g),
    onMoveShouldSetPanResponder: (_, g) => horizontal(g),
    onPanResponderGrant: () => x.stopAnimation(),
    onPanResponderMove: (_, g) => {
      let next = state.offset + g.dx;
      if (!state.props.canReveal) next = Math.max(0, next);
      next = Math.max(OPEN_X - 24, Math.min(COMPLETE_AT + 40, next));
      setSide(next > 0 ? 'right' : next < 0 ? 'left' : 'none');
      x.setValue(next);
    },
    onPanResponderRelease: (_, g) => {
      const end = state.offset + g.dx;
      if (end >= COMPLETE_AT) {
        state.props.onComplete();
        state.settle(0);
      } else if (state.props.canReveal && end <= OPEN_X / 2) {
        state.settle(OPEN_X);
      } else {
        state.settle(0);
      }
    },
    onPanResponderTerminate: () => state.settle(0),
    onPanResponderTerminationRequest: () => false,
  });
  return state;
}

function Action({
  icon,
  label,
  color,
  fg,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  color: string;
  fg: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.action, { backgroundColor: color }]}
    >
      <Icon name={icon} size={20} color={fg} />
      <Text variant="caption" weight={600} color={fg}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Swipe actions on a task row: swipe right past the threshold to complete (or reopen), swipe left to reveal
 * Edit and Delete. Horizontal drags only start after a clear horizontal movement, so vertical scrolling of the list
 * is never captured. Every action is also in the row's "⋯" menu (web, keyboard, screen readers).
 */
export function SwipeRow({
  children,
  done,
  onComplete,
  onQuickEdit,
  onDelete,
  enabled = true,
  testID,
}: {
  children: ReactNode;
  done: boolean;
  onComplete: () => void;
  onQuickEdit?: () => void;
  onDelete?: () => void;
  enabled?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();
  // Dark theme: charcoal on the bright success/danger tones; light theme: white on the deep ones (AA both).
  const onTone = scheme === 'dark' ? charcoal : white;
  const [side, setSide] = useState<'none' | 'left' | 'right'>('none');
  const canReveal = !!(onQuickEdit || onDelete);
  const [swipe] = useState(() => createSwipe(setSide));
  // The responder is created once; it reads the latest props from here.
  useEffect(() => {
    swipe.setProps({ enabled, canReveal, onComplete });
  }, [swipe, enabled, canReveal, onComplete]);

  const run = (fn?: () => void) => () => {
    swipe.settle(0);
    fn?.();
  };
  const x = swipe.x;
  const responder = swipe.responder;

  return (
    <View style={styles.wrap} testID={testID}>
      {side === 'right' ? (
        <View style={[StyleSheet.absoluteFill, styles.under, styles.left, { backgroundColor: colors.success }]}>
          <Icon name="check" size={22} color={onTone} />
          <Text variant="label" weight={600} color={onTone}>
            {done ? t('tasks.swipeReopen') : t('tasks.swipeDone')}
          </Text>
        </View>
      ) : null}
      {side === 'left' ? (
        <View style={[StyleSheet.absoluteFill, styles.under, styles.right]}>
          {onQuickEdit ? (
            <Action
              icon="edit"
              label={t('tasks.quickEdit')}
              color={colors.chip}
              fg={colors.text}
              onPress={run(onQuickEdit)}
              testID="swipe-edit"
            />
          ) : null}
          {onDelete ? (
            <Action
              icon="trash"
              label={t('tasks.delete')}
              color={colors.danger}
              fg={onTone}
              onPress={run(onDelete)}
              testID="swipe-delete"
            />
          ) : null}
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radii.card, overflow: 'hidden' },
  under: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.card },
  left: { justifyContent: 'flex-start', gap: space.xs, paddingLeft: space.lg },
  right: { justifyContent: 'flex-end' },
  action: { width: ACTION_W, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 },
});
