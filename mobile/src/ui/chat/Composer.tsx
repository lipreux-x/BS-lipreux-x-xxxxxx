import * as Haptics from 'expo-haptics';
import { Mic, X } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Led } from '../Led';
import { colors, fonts, hotKey, lcd, led, mono, neon, steel } from '../theme';
import type { Quote } from './replies';
import { durationLabel } from './waveform';

const MAX_LENGTH = 4000;

/**
 * The bottom bar as a strip of the safe's control panel: a metal key for
 * photos, the message typed into a recessed screen, and a red key to send
 * (lit only when there is something to send). Keys press in like the keypad.
 * When answering a message, a strip above shows what is being answered.
 *
 * With nothing typed, the send key is a microphone: one tap starts a voice
 * message. While recording, the screen shows a red LED, the time and the live
 * level; ✕ throws the recording away, the red key sends it.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onAttach,
  attaching,
  replyTo,
  onCancelReply,
  inputRef,
  voice,
}: {
  value: string;
  onChange(text: string): void;
  onSend(): void;
  onAttach(): void;
  /** The photo picker or the image re-encoding is running. */
  attaching: boolean;
  /** The message being answered, if any. */
  replyTo?: Quote | null;
  onCancelReply?(): void;
  /** To bring the keyboard up when a reply starts. */
  inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>;
  voice: {
    phase: 'idle' | 'starting' | 'recording';
    elapsedMs: number;
    /** Latest microphone levels, 0–100. */
    levels: number[];
    onStart(): void;
    onCancel(): void;
    onSend(): void;
  };
}) {
  const canSend = value.trim().length > 0;
  const recording = voice.phase === 'recording';
  return (
    <View>
      {replyTo ? (
        <View style={styles.reply}>
          <View style={styles.replyEdge} />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyTitle} numberOfLines={1}>
              Réponse à {replyTo.author}
            </Text>
            <Text style={styles.replyText} numberOfLines={1}>
              {replyTo.image ? '📷 Photo' : replyTo.voice ? '🎤 Vocal' : replyTo.excerpt}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Annuler la réponse" hitSlop={12} onPress={onCancelReply}>
            <Text style={styles.replyClose}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.bar}>
        {recording ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Annuler le vocal"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              voice.onCancel();
            }}
            style={({ pressed }) => [styles.key, styles.metal, pressed && styles.metalPressed]}
          >
            <X size={22} color={colors.danger} />
          </Pressable>
        ) : (
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
        )}
        <View style={styles.screen}>
          {recording ? (
            <View style={styles.recording} accessibilityLabel={`Enregistrement, ${durationLabel(voice.elapsedMs)}`}>
              <Led state="error" size={8} />
              <Text style={styles.recordTime}>{durationLabel(voice.elapsedMs)}</Text>
              <View style={styles.levels}>
                {voice.levels.map((h, i) => (
                  <View key={i} style={[styles.level, { height: 2 + (h / 100) * 22 }]} />
                ))}
              </View>
            </View>
          ) : (
            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={onChange}
              placeholder="Message chiffré"
              placeholderTextColor={steel.engraving}
              selectionColor={colors.accentFg}
              multiline
              maxLength={MAX_LENGTH}
              style={styles.input}
            />
          )}
        </View>
        {canSend || recording ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Envoyer le vocal' : 'Envoyer'}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (recording) voice.onSend();
              else onSend();
            }}
            style={({ pressed }) => [styles.key, styles.hot, pressed && styles.hotPressed]}
          >
            <Text style={styles.sendLabel}>↑</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enregistrer un vocal"
            disabled={voice.phase === 'starting'}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              voice.onStart();
            }}
            style={({ pressed }) => [styles.key, styles.metal, pressed && styles.metalPressed]}
          >
            {voice.phase === 'starting' ? <ActivityIndicator color={colors.accentFg} /> : <Mic size={22} color={colors.accentFg} />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const KEY = 44;
const METAL = steel.key;
const LIGHT_EDGE = steel.edgeLight;
const DARK_EDGE = steel.edgeDark;

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: steel.panelEdge,
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
    backgroundColor: steel.keyPressed,
    borderTopColor: DARK_EDGE,
    borderLeftColor: DARK_EDGE,
    borderBottomColor: LIGHT_EDGE,
    borderRightColor: LIGHT_EDGE,
    transform: [{ translateY: 1 }],
  },
  // The send key: the blade's red, lit in rose on its upper edges.
  hot: {
    ...neon.box('rgba(255, 59, 78, 0.45)', 10),
    backgroundColor: hotKey.face,
    borderTopColor: hotKey.edgeLight,
    borderLeftColor: hotKey.edgeLight,
    borderBottomColor: hotKey.edgeDark,
    borderRightColor: hotKey.edgeDark,
  },
  hotPressed: {
    backgroundColor: hotKey.facePressed,
    borderTopColor: hotKey.edgeDark,
    borderLeftColor: hotKey.edgeDark,
    borderBottomColor: hotKey.edgeLight,
    borderRightColor: hotKey.edgeLight,
    transform: [{ translateY: 1 }],
  },
  attachLabel: { color: colors.accentFg, fontSize: 26, fontFamily: fonts.medium, lineHeight: 30 },
  sendLabel: { color: colors.text, fontSize: 22, fontFamily: fonts.bold },
  recording: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 40 },
  recordTime: { fontFamily: mono, fontSize: 14, color: colors.text, minWidth: 40 },
  levels: { flex: 1, height: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, overflow: 'hidden' },
  level: { width: 3, borderRadius: 1, backgroundColor: led.ok },
  // Recessed screen: the bevel is inverted (dark on top), like the code display.
  screen: {
    flex: 1,
    minHeight: KEY,
    maxHeight: 140,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: lcd.glass,
    borderWidth: 2,
    borderTopColor: '#000000',
    borderLeftColor: '#000000',
    borderBottomColor: colors.border,
    borderRightColor: colors.border,
  },
  reply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: steel.panelEdge,
  },
  replyEdge: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.accentFg },
  replyTitle: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
  replyText: { color: colors.textDim, fontSize: 13 },
  replyClose: { color: colors.accentFg, fontSize: 18, paddingHorizontal: 4 },
  input: { color: colors.text, fontSize: 16, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, maxHeight: 136 },
});
