import Svg, { Line, Path } from 'react-native-svg';

import { decorativeProps } from '../platform';

import { orange, white } from '../theme/colors';
import { wordmarkHand, wordmarkLetters, wordmarkViewBox } from './wordmarkData';

export const wordmarkAspect = wordmarkViewBox[3] / wordmarkViewBox[2];

/** The `ticktack` wordmark: Space Grotesk Medium outlines with the orange watch-hand dot. Decorative; label the parent. */
export function Wordmark({
  width,
  color = white,
  handColor = orange,
}: {
  width: number;
  color?: string;
  handColor?: string;
}) {
  return (
    <Svg width={width} height={width * wordmarkAspect} viewBox={wordmarkViewBox.join(' ')} {...decorativeProps}>
      <Path d={wordmarkLetters} fill={color} />
      <Line
        x1={wordmarkHand.x1}
        y1={wordmarkHand.y1}
        x2={wordmarkHand.x2}
        y2={wordmarkHand.y2}
        stroke={handColor}
        strokeWidth={wordmarkHand.width}
        strokeLinecap="round"
      />
    </Svg>
  );
}
