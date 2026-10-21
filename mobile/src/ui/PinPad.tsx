import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, fonts } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const;
const GAP = 12;
const PLATE_PAD = 22;
/** Room the rest of a code screen takes (status bar, header, title, subtitle, display, message, gaps). */
const AROUND_PAD = 440;

/**
 * Keys grow with the phone: three across the width (minus the screen and plate
 * margins), as tall as 4/5 of their width, but never so tall that the pad no
 * longer fits under the title and display on a small phone. 76 × 60 at least.
 */
function keySize(width: number, height: number) {
  const w = Math.min(96, Math.max(76, (width - 2 * 24 - 2 * PLATE_PAD - 2 * GAP) / 3));
  const fitH = (height - AROUND_PAD - 2 * PLATE_PAD - 3 * GAP) / 4;
  const h = Math.max(60, Math.min(Math.round(w * 0.8), fitH));
  return { w: Math.floor(w), h: Math.floor(h) };
}

/** Safe keypad: bevelled metal keys on a screwed plate. C clears, ⌫ deletes one digit. */
export function PinPad({
  onDigit,
  onDelete,
  onClear,
  disabled,
}: {
  onDigit(d: string): void;
  onDelete(): void;
  onClear(): void;
  disabled?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const { w, h } = keySize(width, height);
  const size = useMemo(
    () =>
      StyleSheet.create({
        grid: { width: 3 * w + 2 * GAP },
        key: { width: w, height: h },
        label: { fontSize: Math.round(Math.min(34, 28 * (h / 60))) },
        fn: { fontSize: Math.round(Math.min(24, 20 * (h / 60))) },
      }),
    [w, h],
  );
  return (
    <View style={styles.plate}>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} style={[styles.screw, styles[c]]}>
          <View style={styles.slot} />
        </View>
      ))}
      <View style={[styles.grid, size.grid]}>
        {KEYS.map((k) => {
          const fn = k === 'C' || k === '⌫';
          return (
            <Pressable
              key={k}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={k === '⌫' ? 'Effacer' : k === 'C' ? 'Tout effacer' : k}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (k === '⌫') onDelete();
                else if (k === 'C') onClear();
                else onDigit(k);
              }}
              style={({ pressed }) => [styles.key, size.key, pressed && styles.pressed, disabled && styles.disabled]}
            >
              <Text style={[styles.label, size.label, fn && [styles.fn, size.fn]]}>{k}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const METAL = '#24282B';
const LIGHT_EDGE = '#4A5056';
const DARK_EDGE = '#0A0B0C';

const styles = StyleSheet.create({
  plate: {
    padding: PLATE_PAD,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopColor: '#2E2E2E',
    borderLeftColor: '#2E2E2E',
    borderBottomColor: '#000000',
    borderRightColor: '#000000',
  },
  screw: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#3A3F44',
    borderWidth: 1,
    borderColor: DARK_EDGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot: { width: 5, height: 1.5, backgroundColor: DARK_EDGE, transform: [{ rotate: '45deg' }] },
  tl: { top: 7, left: 7 },
  tr: { top: 7, right: 7 },
  bl: { bottom: 7, left: 7 },
  br: { bottom: 7, right: 7 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: GAP },
  key: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: METAL,
    borderWidth: 1.5,
    borderTopColor: LIGHT_EDGE,
    borderLeftColor: LIGHT_EDGE,
    borderBottomColor: DARK_EDGE,
    borderRightColor: DARK_EDGE,
  },
  // Pressed: the bevel inverts, the key looks pushed in.
  pressed: {
    backgroundColor: '#1B1E20',
    borderTopColor: DARK_EDGE,
    borderLeftColor: DARK_EDGE,
    borderBottomColor: LIGHT_EDGE,
    borderRightColor: LIGHT_EDGE,
    transform: [{ translateY: 1 }],
  },
  disabled: { opacity: 0.35 },
  label: { color: colors.text, fontFamily: fonts.medium },
  fn: { color: colors.accentFg },
});
