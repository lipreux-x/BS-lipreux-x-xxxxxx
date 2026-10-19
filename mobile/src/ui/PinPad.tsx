import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const;

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
  return (
    <View style={styles.plate}>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} style={[styles.screw, styles[c]]}>
          <View style={styles.slot} />
        </View>
      ))}
      <View style={styles.grid}>
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
              style={({ pressed }) => [styles.key, pressed && styles.pressed, disabled && styles.disabled]}
            >
              <Text style={[styles.label, fn && styles.fn]}>{k}</Text>
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
    padding: 22,
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 252, justifyContent: 'space-between', rowGap: 12 },
  key: {
    width: 76,
    height: 60,
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
  label: { color: colors.text, fontSize: 28, fontFamily: fonts.medium },
  fn: { fontSize: 20, color: colors.accentFg },
});
