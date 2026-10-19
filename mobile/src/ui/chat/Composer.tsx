import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '../theme';

const MAX_LENGTH = 4000;

/**
 * The bottom bar as a strip of the safe's control panel: a metal key for
 * photos, the message typed into a recessed screen, and a green key to send
 * (lit only when there is something to send). Keys press in like the keypad.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onAttach,
  attaching,
}: {
  value: string;
  onChange(text: string): void;
  onSend(): void;
  onAttach(): void;
  /** The photo picker or the image re-encoding is running. */
  attaching: boolean;
}) {
  const canSend = value.trim().length > 0;
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Envoyer une photo"
        disabled={attaching}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onAttach();
        }}
        style={({ pressed }) => [styles.key, styles.metal, pressed && styles.metalPressed]}
      >
        {attaching ? <ActivityIndicator color={colors.accentFg} /> : <Text style={styles.attachLabel}>+</Text>}
      </Pressable>
      <View style={styles.screen}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Message chiffré"
          placeholderTextColor="#4F5A52"
          selectionColor={colors.forest}
          multiline
          maxLength={MAX_LENGTH}
          style={styles.input}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Envoyer"
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onSend();
        }}
        style={({ pressed }) => [styles.key, canSend ? styles.green : styles.metal, pressed && (canSend ? styles.greenPressed : styles.metalPressed)]}
      >
        <Text style={[styles.sendLabel, !canSend && styles.sendOff]}>↑</Text>
      </Pressable>
    </View>
  );
}

const KEY = 44;
const METAL = '#24282B';
const LIGHT_EDGE = '#4A5056';
const DARK_EDGE = '#0A0B0C';
const GREEN_LIGHT = '#2E8A48';
const GREEN_DARK = '#0F3D1D';

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: '#2E2E2E',
  },
  key: { width: KEY, height: KEY, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  metal: {
    backgroundColor: METAL,
    borderTopColor: LIGHT_EDGE,
    borderLeftColor: LIGHT_EDGE,
    borderBottomColor: DARK_EDGE,
    borderRightColor: DARK_EDGE,
  },
  // Pressed: the bevel inverts, as on the keypad.
  metalPressed: {
    backgroundColor: '#1B1E20',
    borderTopColor: DARK_EDGE,
    borderLeftColor: DARK_EDGE,
    borderBottomColor: LIGHT_EDGE,
    borderRightColor: LIGHT_EDGE,
    transform: [{ translateY: 1 }],
  },
  green: {
    backgroundColor: colors.forest,
    borderTopColor: GREEN_LIGHT,
    borderLeftColor: GREEN_LIGHT,
    borderBottomColor: GREEN_DARK,
    borderRightColor: GREEN_DARK,
  },
  greenPressed: {
    backgroundColor: '#185A2B',
    borderTopColor: GREEN_DARK,
    borderLeftColor: GREEN_DARK,
    borderBottomColor: GREEN_LIGHT,
    borderRightColor: GREEN_LIGHT,
    transform: [{ translateY: 1 }],
  },
  attachLabel: { color: colors.accentFg, fontSize: 26, fontFamily: fonts.medium, lineHeight: 30 },
  sendLabel: { color: colors.text, fontSize: 22, fontFamily: fonts.bold },
  sendOff: { color: '#4A5056' },
  // Recessed screen: the bevel is inverted (dark on top), like the code display.
  screen: {
    flex: 1,
    minHeight: KEY,
    maxHeight: 140,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#0B100C',
    borderWidth: 2,
    borderTopColor: '#000000',
    borderLeftColor: '#000000',
    borderBottomColor: colors.border,
    borderRightColor: colors.border,
  },
  input: { color: colors.text, fontSize: 16, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, maxHeight: 136 },
});
