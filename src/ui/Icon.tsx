import Svg, { Circle, Path } from 'react-native-svg';

export type IconName =
  'today' | 'calendar' | 'goals' | 'routines' | 'me' | 'plus' | 'bell' | 'alert' | 'refresh' | 'close' | 'check';

/** Simple 24 px stroke icons drawn for TickTack (no icon font, no third-party marks). Decorative by default. */
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {name === 'today' && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M12 7.5V12l3.2 2" {...stroke} />
        </>
      )}
      {name === 'calendar' && (
        <>
          <Path d="M5 7.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7.5Z" {...stroke} />
          <Path d="M5 10h14M9 3.5v3M15 3.5v3" {...stroke} />
        </>
      )}
      {name === 'goals' && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Circle cx={12} cy={12} r={4.5} {...stroke} />
          <Circle cx={12} cy={12} r={1} fill={color} />
        </>
      )}
      {name === 'routines' && (
        <>
          <Path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1" {...stroke} />
          <Path d="M17.8 3.8v3.4h-3.4M6.2 20.2v-3.4h3.4" {...stroke} />
        </>
      )}
      {name === 'me' && (
        <>
          <Circle cx={12} cy={8.5} r={3.5} {...stroke} />
          <Path d="M5 19.5c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" {...stroke} />
        </>
      )}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...stroke} strokeWidth={2.2} />}
      {name === 'bell' && (
        <>
          <Path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5l1.5-1.5Z" {...stroke} strokeWidth={2} />
          <Path d="M10 20.5a2 2 0 0 0 4 0" {...stroke} strokeWidth={2} />
        </>
      )}
      {name === 'alert' && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M12 7.5v5.5M12 16.2v.3" {...stroke} strokeWidth={2.2} />
        </>
      )}
      {name === 'refresh' && <Path d="M19 12a7 7 0 1 1-2.1-5M19 4.5V8h-3.5" {...stroke} />}
      {name === 'close' && <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...stroke} strokeWidth={2} />}
      {name === 'check' && <Path d="M5.5 12.5l4 4 9-9" {...stroke} strokeWidth={2.2} />}
    </Svg>
  );
}
