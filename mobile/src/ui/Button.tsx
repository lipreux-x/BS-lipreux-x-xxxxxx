import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors } from './theme';

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
        <ActivityIndicator color={primary ? colors.bg : colors.gold} />
      ) : (
        <Text style={[styles.label, { color: primary ? colors.bg : colors.gold }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: colors.gold },
  ghost: { borderWidth: 1, borderColor: colors.gold },
  label: { fontSize: 16, fontWeight: '600' },
});
