import { ArrowUp, Mic, Plus, X } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Key } from '../Key';
import { Led } from '../Led';
import { screenStyle } from '../Screen';
import { blade, colors, fonts, led, mono, steel } from '../theme';
import { QuoteExcerpt } from './MessageBubble';
import type { Quote } from './replies';
import { durationLabel } from './waveform';

const MAX_LENGTH = 4000;

/**
 * The bottom bar as a strip of the safe's control panel: a metal key for
 * photos, the message typed at a terminal prompt on a recessed screen, and
 * the hot key to send (lit only when there is something to send). Keys press
 * in like the keypad. When answering a message, a strip above shows what is
 * being answered.
 *
 * With nothing typed, the send key is a microphone: one tap starts a voice
 * message. While recording, the screen shows a red LED, the time and the live
 * level; the X key throws the recording away, the hot key sends it.
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
            <QuoteExcerpt quote={replyTo} style={styles.replyText} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Annuler la réponse" hitSlop={12} onPress={onCancelReply}>
            <X size={18} color={colors.accentFg} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.bar}>
        {recording ? (
          <Key square accessibilityLabel="Annuler le vocal" haptic="light" onPress={voice.onCancel}>
            <X size={22} color={colors.danger} />
          </Key>
        ) : (
          <Key square accessibilityLabel="Envoyer une photo" busy={attaching} haptic="light" onPress={onAttach}>
            <Plus size={24} color={colors.accentFg} />
          </Key>
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
            <View style={styles.promptRow}>
              <Text style={styles.prompt}>❯</Text>
              <TextInput
                ref={inputRef}
                value={value}
                onChangeText={onChange}
                placeholder="Message chiffré"
                placeholderTextColor={steel.engraving}
                selectionColor={blade.neon}
                cursorColor={blade.neon}
                multiline
                maxLength={MAX_LENGTH}
                style={styles.input}
              />
            </View>
          )}
        </View>
        {canSend || recording ? (
          <Key
            square
            variant="hot"
            accessibilityLabel={recording ? 'Envoyer le vocal' : 'Envoyer'}
            haptic="medium"
            onPress={() => (recording ? voice.onSend() : onSend())}
          >
            <ArrowUp size={22} color={colors.text} strokeWidth={2.75} />
          </Key>
        ) : (
          <Key square accessibilityLabel="Enregistrer un vocal" busy={voice.phase === 'starting'} haptic="medium" onPress={voice.onStart}>
            <Mic size={22} color={colors.accentFg} />
          </Key>
        )}
      </View>
    </View>
  );
}

const KEY = 44;

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
  recording: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 40 },
  recordTime: { fontFamily: mono, fontSize: 14, color: colors.text, minWidth: 40 },
  levels: { flex: 1, height: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, overflow: 'hidden' },
  level: { width: 3, borderRadius: 1, backgroundColor: led.ok },
  // Recessed screen, like the code display.
  screen: { ...screenStyle, flex: 1, minHeight: KEY, maxHeight: 140, justifyContent: 'center' },
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
  // The prompt and what is typed, in the terminal's font and light.
  promptRow: { flexDirection: 'row', alignItems: 'flex-start' },
  prompt: { fontFamily: mono, fontSize: 15, color: blade.neon, paddingLeft: 12, paddingTop: 11 },
  input: { flex: 1, color: colors.hot, fontFamily: mono, fontSize: 15, paddingLeft: 8, paddingRight: 12, paddingTop: 10, paddingBottom: 10, maxHeight: 136 },
});
