import { Text, type TextStyle } from 'react-native';
import { colors, fonts, neon } from './theme';

/** "BaseSecrète": "Base" in white, "Secrète" in the blade's hot rose, with its neon halo. */
export function Wordmark({ size = 28, style }: { size?: number; style?: TextStyle }) {
  return (
    <Text
      accessibilityRole="header"
      style={[{ color: colors.text, fontSize: size, fontFamily: fonts.bold, letterSpacing: 0.3 }, style]}
    >
      Base<Text style={[{ color: colors.hot }, neon.text(colors.hot, size / 3)]}>Secrète</Text>
    </Text>
  );
}
