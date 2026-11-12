import { Platform } from 'react-native';

/** The native animated driver does not exist on web; Animated falls back to JS there. */
export const useNativeDriver = Platform.OS !== 'web';

/** Hides a purely decorative element (icons, wordmark) from screen readers on every platform. */
export const decorativeProps =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as const)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const);
