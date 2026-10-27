import { Pressable, StyleSheet, Text, View } from 'react-native';
import { bevel, coldPlate, colors, fonts, glow, neon, steel } from './theme';

/**
 * A row of choices, as small steel keys: the chosen one is a cold plate, sky
 * steel lit on its edges. `value` undefined: not loaded yet (disabled).
 * `wrap`: keys as wide as their label, on several lines if needed, instead
 * of sharing the row.
 */
export function Segment<T>({
  options,
  value,
  onChange,
  disabled,
  wrap,
}: {
  options: { label: string; value: T }[];
  value: T | undefined;
  onChange(v: T): void;
  disabled?: boolean;
  wrap?: boolean;
}) {
  return (
    <View style={[styles.row, wrap && styles.wrap]}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.label}
            disabled={disabled || value === undefined || on}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: disabled || value === undefined }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.key, !wrap && styles.share, on && styles.on, pressed && styles.pressed, (disabled || value === undefined) && styles.disabled]}
          >
            <Text style={[styles.text, on && styles.textOn]} numberOfLines={1} adjustsFontSizeToFit>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  wrap: { flexWrap: 'wrap' },
  key: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: steel.key,
    borderWidth: 1,
    ...bevel(steel.edgeLight, steel.edgeDark),
  },
  share: { flex: 1 },
  on: { backgroundColor: colors.accent, ...bevel(coldPlate.edgeLight, coldPlate.edgeDark), ...neon.box(glow.cold, 6) },
  pressed: { backgroundColor: steel.keyPressed, ...bevel(steel.edgeLight, steel.edgeDark, true), transform: [{ translateY: 1 }] },
  disabled: { opacity: 0.4 },
  text: { color: colors.textDim, fontFamily: fonts.medium, fontSize: 14 },
  textOn: { color: colors.text, fontFamily: fonts.semibold },
});
