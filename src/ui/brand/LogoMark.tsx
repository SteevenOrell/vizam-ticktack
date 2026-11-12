import Svg, { Circle, G, Path } from 'react-native-svg';

import { decorativeProps } from '../platform';
import { charcoal, orange } from '../theme/colors';

export const logoCream = '#F4EFE6';

/**
 * The TickTack mark: a dart in the bullseye. Geometry in a 200-unit box centred on the bullseye; keep in sync with
 * assets/brand/logo-target.svg and scripts/render-brand.mjs. `gap` is the colour behind the mark (the 3-unit
 * gap where the dart crosses the rings). Decorative; label the parent.
 */
export function LogoMark({
  size,
  ring = orange,
  dart = logoCream,
  gap = charcoal,
}: {
  size: number;
  ring?: string;
  dart?: string;
  gap?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" {...decorativeProps}>
      <G fill="none" stroke={ring} strokeWidth={12}>
        <Circle cx={100} cy={100} r={68} />
        <Circle cx={100} cy={100} r={42} />
      </G>
      <Circle cx={100} cy={100} r={15} fill={ring} />
      <Path d="M166 34 L104 96" stroke={gap} strokeWidth={12} strokeLinecap="round" fill="none" />
      <G fill="none" stroke={dart} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M166 34 L104 96" strokeWidth={6} />
        <Path d="M175 38 L162 38 L162 25" strokeWidth={4} />
        <Path d="M163 50 L150 50 L150 37" strokeWidth={4} />
      </G>
    </Svg>
  );
}
