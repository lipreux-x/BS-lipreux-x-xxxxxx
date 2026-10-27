import { Text, type TextStyle } from 'react-native';
import { blade, colors, fonts, glow, neon } from './theme';

/** "BaseSecrète": "Base" in white, "Secrète" in the terminal's green, crisp, with a tight halo. */
export function Wordmark({ size = 28, style }: { size?: number; style?: TextStyle }) {
  return (
    <Text
      accessibilityRole="header"
      style={[{ color: colors.text, fontSize: size, fontFamily: fonts.bold, letterSpacing: 0.3 }, style]}
    >
      Base<Text style={[{ color: blade.neon }, neon.text(glow.hotText, size / 7)]}>Secrète</Text>
    </Text>
  );
}
