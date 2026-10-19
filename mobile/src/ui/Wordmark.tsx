import { Text, type TextStyle } from 'react-native';
import { colors, fonts } from './theme';

/** "BaseSecrète": "Base" in white, "Secrète" in the anthracite grey accent. */
export function Wordmark({ size = 28, style }: { size?: number; style?: TextStyle }) {
  return (
    <Text
      accessibilityRole="header"
      style={[{ color: colors.text, fontSize: size, fontFamily: fonts.bold, letterSpacing: 0.3 }, style]}
    >
      Base<Text style={{ color: colors.accentFg }}>Secrète</Text>
    </Text>
  );
}
