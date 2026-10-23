import Svg, { Defs, FeGaussianBlur, Filter, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { blade } from './theme';

/*
 * The blade of the app icon: a twisted ribbon of light, sky blue at its
 * upper tip, neon red at its point, with pale filaments running along it.
 * Drawn in a square (100 units, like the icon), so `width` is also its
 * height; the blade itself takes the middle two thirds. Its neon is real:
 * two blurred copies of the shape under the crisp one.
 */

/** Upper lobe, tip to twist. */
const UPPER = 'M54 16.5 C52.3 19 49.2 25 47.6 32 C46.6 37.5 46.9 43.5 48.6 47.4 C49.3 48.9 49.9 50 50.4 50.8 L52 50.8 C52.5 46.5 52.5 41 52.4 35 C52.3 29 53 22 54 16.5 Z';
/** Lower lobe, twist to point. */
const LOWER = 'M50.4 50.8 C49.9 56 49.6 62 49.2 66.5 C48.8 71 48 76 46.5 83 C47.9 79.5 50 75 51.4 69.5 C52.8 64 53.6 57 52 50.8 Z';
const FILAMENTS = [
  'M53.2 19 C50.5 25 48.5 33 48.3 41 C48.3 45.5 49.5 49 50.8 50.8 C52 53 53 58 52.8 63 C52.5 69 50.3 76 47.5 82',
  'M53.6 21 C52 27 50.3 35 50.1 42 C50.1 46 50.8 49 51.5 50.8 C52.5 54 53.4 60 53 66 C52.6 71 50.8 77 48.5 81',
  'M53 25 C51.5 31 51 38 51.3 45',
];

export function Logo({ width = 64 }: { width?: number }) {
  return (
    <Svg width={width} height={width} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="bladeLight" gradientUnits="userSpaceOnUse" x1="0" y1="16" x2="0" y2="84">
          <Stop offset="0" stopColor={blade.skyLight} />
          <Stop offset="0.3" stopColor={blade.sky} />
          <Stop offset="0.47" stopColor={blade.sky} />
          <Stop offset="0.53" stopColor={blade.rose} />
          <Stop offset="0.75" stopColor={blade.neon} />
          <Stop offset="1" stopColor={blade.neon} />
        </LinearGradient>
        <Filter id="bladeHalo" x="-100%" y="-30%" width="300%" height="160%">
          <FeGaussianBlur stdDeviation="3" />
        </Filter>
        <Filter id="bladeGlow" x="-60%" y="-20%" width="220%" height="140%">
          <FeGaussianBlur stdDeviation="0.8" />
        </Filter>
      </Defs>
      <G filter="url(#bladeHalo)" opacity={0.4}>
        <Path d={UPPER} fill="url(#bladeLight)" />
        <Path d={LOWER} fill="url(#bladeLight)" />
      </G>
      <G filter="url(#bladeGlow)" opacity={0.9}>
        <Path d={UPPER} fill="url(#bladeLight)" />
        <Path d={LOWER} fill="url(#bladeLight)" />
      </G>
      <Path d={UPPER} fill="url(#bladeLight)" />
      <Path d={LOWER} fill="url(#bladeLight)" />
      {FILAMENTS.map((d) => (
        <Path key={d} d={d} fill="none" stroke={blade.filament} strokeOpacity={0.55} strokeWidth={0.45} strokeLinecap="round" />
      ))}
    </Svg>
  );
}
