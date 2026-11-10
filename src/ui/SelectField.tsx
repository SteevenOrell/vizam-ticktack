import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { radii, sizes, space } from './theme/layout';
import { useTheme } from './theme/ThemeProvider';
import { useFocusRing } from './useFocusRing';

export interface SelectOption<V> {
  value: V;
  label: string;
}

const ROW = 48;

function OptionRow({
  label,
  selected,
  onPress,
  testID,
  setRef,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  setRef: (node: ComponentRef<typeof View> | null) => void;
}) {
  const { colors } = useTheme();
  const [focused, focusHandlers] = useFocusRing();
  return (
    <Pressable
      ref={setRef}
      {...focusHandlers}
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={label}
      style={[
        styles.option,
        {
          backgroundColor: selected ? colors.chip : 'transparent',
          borderColor: focused ? colors.focus : 'transparent',
        },
      ]}
    >
      <Text
        variant="body"
        weight={selected ? 600 : 400}
        color={selected ? colors.text : colors.text}
        style={[styles.flex, styles.tabular]}
      >
        {label}
      </Text>
      {selected ? <Icon name="check" size={20} color={colors.accentText} /> : null}
    </Pressable>
  );
}

/**
 * Dropdown: a field-like button that opens a sheet with a scrollable list (bottom sheet on phones, centred panel on
 * wide web). The list opens scrolled to the selected row (or `initialIndex`). Web keyboard: Tab / arrows move,
 * Enter or Space picks, Escape closes.
 */
export function SelectField<V extends string | number | null>({
  label,
  value,
  options,
  onChange,
  closeLabel,
  testID,
  initialIndex,
  compact,
  extra,
  error,
}: {
  label: string;
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  closeLabel: string;
  testID?: string;
  /** Row to show first when nothing is selected (e.g. the current time). */
  initialIndex?: number;
  /** Smaller trigger without the label above it (label is still announced). */
  compact?: boolean;
  /** Content under the list inside the sheet (e.g. "Create a goal"). */
  extra?: (close: () => void) => ReactNode;
  error?: string | null;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [focused, focusHandlers] = useFocusRing();
  const listRef = useRef<FlatList<SelectOption<V>>>(null);
  const rowRefs = useRef(new Map<number, ComponentRef<typeof View>>());
  const selectedIndex = options.findIndex((o) => o.value === value);
  const startIndex = Math.max(0, selectedIndex >= 0 ? selectedIndex : (initialIndex ?? 0));
  const current = selectedIndex >= 0 ? options[selectedIndex]?.label : undefined;
  const close = useCallback(() => setOpen(false), []);

  // Web keyboard support: focus the selected row on open; arrows move between rows.
  const focusIndex = useRef(startIndex);
  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return;
    focusIndex.current = startIndex;
    const focus = (i: number) => {
      const clamped = Math.max(0, Math.min(options.length - 1, i));
      focusIndex.current = clamped;
      listRef.current?.scrollToIndex({ index: clamped, viewPosition: 0.5, animated: false });
      requestAnimationFrame(() => (rowRefs.current.get(clamped) as unknown as HTMLElement | undefined)?.focus?.());
    };
    const timer = setTimeout(() => focus(startIndex), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        focus(focusIndex.current + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        focus(e.key === 'Home' ? 0 : options.length - 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, options.length, startIndex]);

  return (
    <View style={styles.wrap}>
      {compact ? null : (
        <Text variant="label" color={colors.textSecondary}>
          {label}
        </Text>
      )}
      <Pressable
        {...focusHandlers}
        testID={testID}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current ?? '—'}`}
        accessibilityState={{ expanded: open }}
        accessibilityHint={error ?? undefined}
        style={[
          styles.trigger,
          compact ? styles.triggerCompact : null,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : focused ? colors.focus : colors.border,
          },
        ]}
      >
        <Text variant="body" weight={500} style={[styles.flex, styles.tabular]} numberOfLines={1}>
          {current ?? '—'}
        </Text>
        <Icon name="chevronDown" size={18} color={colors.textSecondary} />
      </Pressable>
      {error ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Sheet
        visible={open}
        title={label}
        onClose={close}
        closeLabel={closeLabel}
        testID={testID ? `${testID}-sheet` : undefined}
      >
        <FlatList
          ref={listRef}
          data={options as SelectOption<V>[]}
          keyExtractor={(o) => String(o.value)}
          getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
          initialScrollIndex={Math.max(0, Math.min(options.length - 1, startIndex - 2))}
          // Short lists (at most ~100 rows): render them all so keyboard focus and tests can reach any row.
          initialNumToRender={options.length}
          accessibilityRole="radiogroup"
          accessibilityLabel={label}
          style={styles.list}
          renderItem={({ item, index }) => (
            <OptionRow
              label={item.label}
              selected={item.value === value}
              testID={testID ? `${testID}-option-${String(item.value)}` : undefined}
              setRef={(node) => {
                if (node) rowRefs.current.set(index, node);
                else rowRefs.current.delete(index);
              }}
              onPress={() => {
                onChange(item.value);
                setOpen(false);
              }}
            />
          )}
        />
        {extra ? extra(close) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xxs, flexShrink: 1 },
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  trigger: {
    minHeight: sizes.buttonLarge - 4,
    borderWidth: 2,
    borderRadius: radii.input,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  triggerCompact: { minHeight: sizes.touch },
  // Shrinks above the keyboard so the content under the list (e.g. "New goal") stays reachable.
  list: { flexGrow: 0, flexShrink: 1 },
  option: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radii.input,
    borderWidth: 2,
  },
});
