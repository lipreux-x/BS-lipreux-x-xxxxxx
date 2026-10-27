import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { colors, mono } from './theme';

/** The engraving on the safe's panels: small monospace capitals, spaced out. */
export const labelText = { fontFamily: mono, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.textDim } as const;

/**
 * An engraved label: the title of a panel, the name of a section, the
 * caption of a screen. `lit`: in the cold light instead of the engraving's
 * grey. Takes an icon on its left.
 */
export function Label({
  children,
  icon: Icon,
  lit,
  style,
  textStyle,
}: {
  children: string;
  icon?: LucideIcon;
  lit?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const color = lit ? colors.accentFg : colors.textDim;
  return (
    <View style={[styles.row, style]}>
      {Icon ? <Icon size={14} color={color} strokeWidth={2.25} /> : null}
      <Text style={[labelText, { color }, textStyle]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
