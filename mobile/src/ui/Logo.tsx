import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from './theme';

/** Gold of the keyhole, as on the app icon. */
const GOLD = '#D3B03A';

/** The app icon's eye with its gold keyhole, without the black square. */
export function Logo({ width = 64 }: { width?: number }) {
  return (
    <Svg width={width} height={width * 0.6} viewBox="0 0 100 60" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M4 30 Q50 -6 96 30 Q50 66 4 30 Z" fill="none" stroke={colors.text} strokeWidth={4} strokeLinejoin="round" />
      <Circle cx={50} cy={25} r={7} fill={GOLD} />
      <Path d="M46.5 28 L53.5 28 L56 42 L44 42 Z" fill={GOLD} />
    </Svg>
  );
}
