import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

/** On web, only keyboard focus (`:focus-visible`) draws the ring; a mouse click or tap does not. */
function isKeyboardFocus(event: unknown): boolean {
  if (Platform.OS !== 'web') return true;
  const target = (event as { target?: { matches?: (selector: string) => boolean } } | undefined)?.target;
  try {
    return target?.matches ? target.matches(':focus-visible') : true;
  } catch {
    return true; // browsers without :focus-visible keep the ring
  }
}

/** Tracks keyboard/accessibility focus so controls can draw a visible 3:1 focus ring (web and hardware keyboards). */
export function useFocusRing() {
  const [focused, setFocused] = useState(false);
  const handlers = useMemo(
    () => ({ onFocus: (event?: unknown) => setFocused(isKeyboardFocus(event)), onBlur: () => setFocused(false) }),
    [],
  );
  return [focused, handlers] as const;
}
