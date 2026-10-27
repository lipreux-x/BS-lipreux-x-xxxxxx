import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { bevel, blade, colors, dangerKey, fonts, glow, hotKey, neon, steel } from './theme';

export type KeyVariant = 'steel' | 'hot' | 'danger';
export type KeySize = 'sm' | 'md' | 'lg';
/** The colour of a steel key's label: white by default, the cold light for a tool or a cancel, dim for a lesser choice, the red light for a warning. */
export type KeyTone = 'text' | 'cold' | 'dim' | 'alert';

/**
 * A key of the safe's control panel, the only button of the app: bevelled
 * metal, lit on its upper-left edges and dark below; pressed, the bevel
 * inverts and the key sinks by a pixel, as on the keypad.
 *
 * `steel`: neutral (cancel, a tool, a lesser choice). `hot`: the action
 * (send, open, confirm), the blade's green with its halo. `danger`: what
 * cannot be undone, near-black red with the red edge.
 *
 * `label` prints a text; `children` draws anything else (an icon). `square`
 * makes an icon key as wide as tall. `grow` lets it fill its row.
 */
export function Key({
  label,
  children,
  onPress,
  onLongPress,
  variant = 'steel',
  size = 'md',
  tone = 'text',
  square,
  grow,
  busy,
  disabled,
  haptic,
  style,
  accessibilityLabel,
  accessibilityHint,
  hitSlop,
}: {
  label?: string;
  children?: ReactNode;
  onPress(): void;
  onLongPress?(): void;
  variant?: KeyVariant;
  size?: KeySize;
  tone?: KeyTone;
  square?: boolean;
  grow?: boolean;
  /** Shows a spinner in place of the label, and disables the key. */
  busy?: boolean;
  disabled?: boolean;
  /** A tap of the phone when the key is pressed. */
  haptic?: 'light' | 'medium';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  hitSlop?: number;
}) {
  const face = FACE[variant];
  const dims = SIZE[size];
  const labelColor = variant === 'danger' ? colors.danger : variant === 'hot' ? colors.text : TONE[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={hitSlop}
      disabled={disabled || busy}
      onLongPress={onLongPress}
      onPress={() => {
        if (haptic) void Haptics.impactAsync(haptic === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={({ pressed }) => [
        styles.key,
        { height: dims.h, borderRadius: dims.radius, borderWidth: dims.border, paddingHorizontal: square ? 0 : dims.padX },
        square && { width: dims.h },
        grow && styles.grow,
        { backgroundColor: pressed ? face.facePressed : face.face, ...bevel(face.edgeLight, face.edgeDark, pressed) },
        variant === 'hot' && !pressed && neon.box(glow.hot, dims.halo),
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={labelColor} />
      ) : label !== undefined ? (
        <Text
          style={[styles.label, { color: labelColor, fontSize: dims.font, fontFamily: variant === 'steel' ? fonts.medium : fonts.semibold }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {label}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

const FACE: Record<KeyVariant, { face: string; facePressed: string; edgeLight: string; edgeDark: string }> = {
  steel: { face: steel.key, facePressed: steel.keyPressed, edgeLight: steel.edgeLight, edgeDark: steel.edgeDark },
  hot: { face: hotKey.face, facePressed: hotKey.facePressed, edgeLight: hotKey.edgeLight, edgeDark: hotKey.edgeDark },
  danger: { face: dangerKey.face, facePressed: blade.black, edgeLight: dangerKey.edge, edgeDark: steel.edgeDark },
};

const SIZE: Record<KeySize, { h: number; radius: number; border: number; padX: number; font: number; halo: number }> = {
  sm: { h: 38, radius: 8, border: 1, padX: 12, font: 14, halo: 8 },
  md: { h: 44, radius: 8, border: 1.5, padX: 16, font: 15, halo: 10 },
  lg: { h: 52, radius: 10, border: 1.5, padX: 20, font: 16, halo: 14 },
};

const TONE: Record<KeyTone, string> = { text: colors.text, cold: colors.accentFg, dim: colors.textDim, alert: colors.danger };

const styles = StyleSheet.create({
  key: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  pressed: { transform: [{ translateY: 1 }] },
  disabled: { opacity: 0.4 },
  label: { letterSpacing: 0.3 },
});
