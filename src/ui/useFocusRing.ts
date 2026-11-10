import { useMemo, useState } from 'react';

/** Tracks keyboard/accessibility focus so controls can draw a visible 3:1 focus ring (web and hardware keyboards). */
export function useFocusRing() {
  const [focused, setFocused] = useState(false);
  const handlers = useMemo(() => ({ onFocus: () => setFocused(true), onBlur: () => setFocused(false) }), []);
  return [focused, handlers] as const;
}
