import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { bevel, coldPlate, colors, fonts, glow, neon, steel } from './theme';

const GAP = 8;

/**
 * A row of choices, as small steel keys: the chosen one is a cold plate, sky
 * steel lit on its edges. `value` undefined: not loaded yet (disabled).
 * `wrap`: keys as wide as their label, on several lines if needed, instead
 * of sharing the row.
 * `slide`: where the cold plate stands, from 0 (first key) to the last key's
 * index, fractions in between (a pager under the keys, followed by the
 * finger): the plate passes from one key into the next, each key showing the
 * part of it that is over it, never the gap between them; the glow and the lit
 * label fade across.
 */
export function Segment<T>({
  options,
  value,
  onChange,
  disabled,
  wrap,
  slide,
}: {
  options: { label: string; value: T }[];
  value: T | undefined;
  onChange(v: T): void;
  disabled?: boolean;
  wrap?: boolean;
  slide?: Animated.AnimatedDivision;
}) {
  const [keyWidth, setKeyWidth] = useState(0);
  if (slide && !wrap) {
    const lit = (i: number) => slide.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [0, 1, 0], extrapolate: 'clamp' });
    return (
      <View style={styles.row}>
        {options.map((o, i) => {
          const on = value === o.value;
          // The plate as this key sees it: under it at `i`, one key (and a gap) to the side otherwise.
          const plateX = Animated.multiply(Animated.subtract(slide, i), keyWidth + GAP);
          return (
            <View key={o.label} style={styles.share} onLayout={i === 0 ? (e) => setKeyWidth(e.nativeEvent.layout.width) : undefined}>
              {/* The glow around the key, as much as the plate is in it. */}
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.key, styles.on, { opacity: lit(i) }]} />
              <Pressable
                disabled={disabled || value === undefined || on}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                accessibilityState={{ selected: on, disabled: disabled || value === undefined }}
                onPress={() => onChange(o.value)}
                style={({ pressed }) => [styles.key, styles.clip, pressed && styles.pressed, (disabled || value === undefined) && styles.disabled]}
              >
                {keyWidth > 0 ? <Animated.View pointerEvents="none" style={[styles.plate, { transform: [{ translateX: plateX }] }]} /> : null}
                <Text style={styles.text} numberOfLines={1} adjustsFontSizeToFit>
                  {o.label}
                </Text>
                <Animated.Text style={[styles.text, styles.textOn, styles.litLabel, { opacity: lit(i) }]} numberOfLines={1} adjustsFontSizeToFit>
                  {o.label}
                </Animated.Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    );
  }
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
  row: { flexDirection: 'row', gap: GAP },
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
  // A key that shows only what of the gliding plate is over it.
  clip: { overflow: 'hidden' },
  // The gliding plate, over the key's own edges.
  plate: {
    position: 'absolute',
    top: -1,
    bottom: -1,
    left: -1,
    right: -1,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: colors.accent,
    ...bevel(coldPlate.edgeLight, coldPlate.edgeDark),
  },
  // The lit label, over the dim one, fading in as the plate comes under it.
  litLabel: { position: 'absolute' },
  pressed: { backgroundColor: steel.keyPressed, ...bevel(steel.edgeLight, steel.edgeDark, true), transform: [{ translateY: 1 }] },
  disabled: { opacity: 0.4 },
  text: { color: colors.textDim, fontFamily: fonts.medium, fontSize: 14 },
  textOn: { color: colors.text, fontFamily: fonts.semibold },
});
