import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { blade, colors } from './theme';

/** The app icon's eye, its keyhole lit along the blade: sky blue above, neon red at the point. */
export function Logo({ width = 64 }: { width?: number }) {
  return (
    <Svg width={width} height={width * 0.6} viewBox="0 0 100 60" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="keyhole" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={blade.skyLight} />
          <Stop offset="0.35" stopColor={blade.sky} />
          <Stop offset="0.7" stopColor={blade.rose} />
          <Stop offset="1" stopColor={blade.neon} />
        </LinearGradient>
      </Defs>
      <Path d="M4 30 Q50 -6 96 30 Q50 66 4 30 Z" fill="none" stroke={colors.text} strokeWidth={4} strokeLinejoin="round" />
      <Circle cx={50} cy={25} r={7} fill="url(#keyhole)" />
      <Path d="M46.5 28 L53.5 28 L56 42 L44 42 Z" fill="url(#keyhole)" />
    </Svg>
  );
}
