import { Platform } from 'react-native';

/**
 * Web-only layout rules (VIZAM rule for every site): below 250 px the layout locks at 500 px wide and visitors pan
 * horizontally. `#root` and fixed layers (React Native Web modals and portals are appended to <body>) get the lock;
 * fixed layers also drop their right anchor.
 */
export const NARROW_LOCK_CSS = `
html { overflow-x: auto; }
@media (max-width: 250px) {
  #root { width: 500px !important; min-width: 500px !important; }
  body > div:not(#root) { width: 500px !important; right: auto !important; }
}
`;

export function installWebLayoutRules(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('ticktack-web-layout')) return;
  const style = document.createElement('style');
  style.id = 'ticktack-web-layout';
  style.textContent = NARROW_LOCK_CSS;
  document.head.appendChild(style);
}
