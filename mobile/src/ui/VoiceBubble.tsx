import { Pause, Play } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import type { VoiceBody } from '@/crypto';
import { loadAttachment, type Session } from '@/services/groups';
import { usePlayback, useRecordingVoice, voicePlayer, type VoiceTrack } from '@/services/voice';
import { LONG_PRESS_MS } from './chat/MessageBubble';
import { durationLabel, stretch } from './chat/waveform';
import { colors, led, mono } from './theme';

// A finger that moves less than this before the long press is still holding, not scrubbing.
const HOLD_SLOP = 10;

/**
 * A voice message: a play key, its waveform lit as it plays, and its length
 * on the LCD font. The audio is downloaded and decrypted on the first play,
 * then kept in memory for the session.
 *
 * As on the usual messaging apps, tapping the waveform jumps there and
 * dragging along it scrubs (the move happens when the finger lifts). A long
 * press, on the waveform or the keys, opens the message's actions. While a
 * voice message is being recorded, nothing plays: the play key is off.
 */
export function VoiceBubble({ track, waveform, onLongPress }: { track: VoiceTrack; waveform?: number[]; onLongPress?(): void }) {
  const playback = usePlayback(track.id);
  const recording = useRecordingVoice();
  const bars = useMemo(() => stretch(waveform), [waveform]);
  // Where the finger is while scrubbing (0–1), null otherwise.
  const [scrub, setScrub] = useState<number | null>(null);
  const width = useRef(1);
  // Where the finger came down (fraction and screen x), where it is now, and
  // whether it was held long enough to open the actions (then it is no scrub).
  const drag = useRef({ from: 0, pageX: 0, at: 0, held: false });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const progress = scrub ?? (playback.id ? Math.min(1, playback.positionMs / track.durationMs) : 0);
  const lit = Math.round(progress * bars.length);
  const shownMs = scrub !== null ? scrub * track.durationMs : playback.id && playback.positionMs > 0 ? playback.positionMs : track.durationMs;
  const clamp = (f: number) => Math.min(1, Math.max(0, f));
  /*
   * During a move, locationX is relative to whatever view is under the
   * finger (and jumps around on Android): only the first touch reads it, on
   * the waveform itself; the drag then follows the finger's screen position.
   */
  function grant(e: GestureResponderEvent) {
    const from = clamp(e.nativeEvent.locationX / width.current);
    drag.current = { from, pageX: e.nativeEvent.pageX, at: from, held: false };
    setScrub(from);
    clearTimeout(holdTimer.current);
    if (onLongPress) {
      holdTimer.current = setTimeout(() => {
        drag.current.held = true;
        setScrub(null);
        onLongPress();
      }, LONG_PRESS_MS);
    }
  }
  function move(e: GestureResponderEvent) {
    const { from, pageX, held } = drag.current;
    if (held) return;
    if (Math.abs(e.nativeEvent.pageX - pageX) > HOLD_SLOP) clearTimeout(holdTimer.current);
    drag.current.at = clamp(from + (e.nativeEvent.pageX - pageX) / width.current);
    setScrub(drag.current.at);
  }
  function release(e: GestureResponderEvent) {
    clearTimeout(holdTimer.current);
    if (drag.current.held) return;
    move(e);
    setScrub(null);
    voicePlayer.seek(track, drag.current.at);
  }

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playback.playing ? 'Pause' : `Écouter le vocal, ${durationLabel(track.durationMs)}`}
          hitSlop={8}
          disabled={recording}
          onPress={() => voicePlayer.toggle(track)}
          onLongPress={onLongPress}
          delayLongPress={LONG_PRESS_MS}
          style={({ pressed }) => [styles.key, pressed && styles.keyPressed, recording && styles.keyOff]}
        >
          {playback.loading ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : playback.playing ? (
            <Pause size={18} color={colors.text} fill={colors.text} />
          ) : (
            <Play size={18} color={colors.text} fill={colors.text} style={{ marginLeft: 2 }} />
          )}
        </Pressable>
        <View
          style={styles.wave}
          onLayout={(e) => (width.current = Math.max(1, e.nativeEvent.layout.width))}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Position dans le vocal"
          accessibilityValue={{ text: `${durationLabel(shownMs)} sur ${durationLabel(track.durationMs)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const step = 5000 / track.durationMs;
            voicePlayer.seek(track, progress + (e.nativeEvent.actionName === 'increment' ? step : -step));
          }}
          // The waveform keeps the finger: no reply swipe while scrubbing (its own
          // long press opens the actions). While recording it lets the bubble have it.
          onStartShouldSetResponder={() => !recording}
          onMoveShouldSetResponder={() => !recording}
          onResponderTerminationRequest={() => false}
          onResponderGrant={grant}
          onResponderMove={move}
          onResponderRelease={release}
          onResponderTerminate={() => {
            clearTimeout(holdTimer.current);
            setScrub(null);
          }}
        >
          {bars.map((h, i) => (
            <View key={i} pointerEvents="none" style={[styles.bar, { height: 3 + (h / 100) * 21 }, i < lit && styles.barLit]} />
          ))}
          {playback.id || scrub !== null ? <View pointerEvents="none" style={[styles.thumb, { left: `${progress * 100}%` }]} /> : null}
        </View>
        {playback.id ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Vitesse ${rateLabel(playback.rate)}, touche pour changer`}
            hitSlop={8}
            onPress={() => voicePlayer.cycleRate()}
            onLongPress={onLongPress}
            delayLongPress={LONG_PRESS_MS}
            style={({ pressed }) => [styles.rate, pressed && styles.ratePressed]}
          >
            <Text style={styles.rateText}>{rateLabel(playback.rate)}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.duration}>{durationLabel(shownMs)}</Text>
      </View>
      {playback.failed ? (
        <Text style={styles.error}>{playback.failed.gone ? 'Vocal expiré' : 'Vocal indisponible — touche lecture pour réessayer'}</Text>
      ) : null}
    </View>
  );
}

/** The track of a voice message received or sent: downloaded and decrypted when first played. */
export function voiceTrack(session: Session, groupId: string, body: VoiceBody): VoiceTrack {
  return { id: body.attachmentId, durationMs: body.durationMs, load: () => loadAttachment(session, groupId, body) };
}

/** The bubble of a voice message received or sent. */
export function SentVoice({ session, groupId, body, onLongPress }: { session: Session; groupId: string; body: VoiceBody; onLongPress?(): void }) {
  const track = useMemo(() => voiceTrack(session, groupId, body), [session, groupId, body]);
  return <VoiceBubble track={track} waveform={body.waveform} onLongPress={onLongPress} />;
}

/** "1×", "1,5×", "2×". */
const rateLabel = (rate: number) => `${String(rate).replace('.', ',')}×`;

const THUMB = 10;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 220, paddingVertical: 2 },
  key: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.forest,
    borderWidth: 1,
    borderTopColor: '#2E8A48',
    borderLeftColor: '#2E8A48',
    borderBottomColor: '#0F3D1D',
    borderRightColor: '#0F3D1D',
  },
  keyPressed: { transform: [{ translateY: 1 }], backgroundColor: '#185A2B' },
  // Off while a voice message is being recorded.
  keyOff: { opacity: 0.35 },
  // Taller than the bars: an easier target for the finger. Wide enough that
  // the speed key, when it shows up, widens the bubble instead of crushing
  // the bars (40 bars and their gaps).
  wave: { flex: 1, minWidth: 150, height: 34, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  barLit: { backgroundColor: led.green },
  thumb: {
    position: 'absolute',
    top: (34 - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: led.green,
    borderWidth: 1,
    borderColor: '#0F3D1D',
  },
  // Shown while the message is loaded in the player, as on the usual messaging apps.
  // Same width for 1×, 1,5× and 2×: the waveform doesn't shift when it changes.
  rate: {
    width: 40,
    paddingVertical: 2,
    borderRadius: 9,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  ratePressed: { backgroundColor: 'rgba(0,0,0,0.6)' },
  rateText: { fontFamily: mono, fontSize: 11, color: colors.text },
  duration: { fontFamily: mono, fontSize: 11, color: colors.textDim, minWidth: 32, textAlign: 'right' },
  error: { color: colors.text, fontSize: 12, marginTop: 4 },
});
