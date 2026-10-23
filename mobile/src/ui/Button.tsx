import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts, neon } from './theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  busy,
  disabled,
}: {
  title: string;
  onPress(): void;
  variant?: 'primary' | 'ghost';
  busy?: boolean;
  disabled?: boolean;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.ghost,
        pressed && { opacity: 0.8 },
        (disabled || busy) && { opacity: 0.4 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.text : colors.accentFg} />
      ) : (
        <Text style={[styles.label, { color: primary ? colors.text : colors.accentFg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  // The action, in the blade's red; ghost: a cold outline.
  primary: { backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.hot, ...neon.box('rgba(255, 59, 78, 0.45)', 14) },
  ghost: { borderWidth: 1, borderColor: colors.accentFg },
  label: { fontSize: 16, fontFamily: fonts.semibold, letterSpacing: 0.3 },
});
