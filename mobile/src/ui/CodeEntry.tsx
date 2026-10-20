import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { PinPad } from './PinPad';
import { SafeDisplay, type SafeDisplayHandle } from './SafeDisplay';
import { colors, space, type } from './theme';

/**
 * Title + safe display + safe keypad. `onComplete` returns an error message to
 * show (the display shakes, its LED goes red), null to move on, or an `open`
 * callback: the LED goes green for a beat, then `open` runs. While it runs, the
 * pad is disabled and the LED turns amber: Argon2id takes a moment on the phone.
 */
export type CodeResult = string | null | (() => void);

const GREEN_BEAT_MS = 550;

export function CodeEntry({
  title,
  subtitle,
  length = 6,
  onComplete,
  lockedForMs = 0,
  initialError,
}: {
  title: string;
  subtitle?: string;
  length?: number;
  onComplete(code: string): Promise<CodeResult>;
  lockedForMs?: number;
  /** Shown until the first key press, e.g. "codes do not match" from the previous step. */
  initialError?: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [wait, setWait] = useState(lockedForMs);
  const display = useRef<SafeDisplayHandle>(null);

  // Arriving with an error (e.g. sent back from the confirm step): red LED, shake.
  useEffect(() => {
    if (!initialError) return;
    display.current?.shake();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    // Mount only: the error belongs to the step that sent us here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Counted down from an end time, not by 1 s steps: timers stop while the app
  // is in the background, so the wait is recomputed when it comes back.
  useEffect(() => {
    const until = Date.now() + lockedForMs;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const left = Math.max(0, until - Date.now());
      setWait(left);
      if (left > 0) t = setTimeout(tick, Math.min(1000, left));
    };
    t = setTimeout(tick, 0);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      clearTimeout(t);
      tick();
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [lockedForMs]);

  async function submit(full: string) {
    setBusy(true);
    // Let the spinner render before the (synchronous) key derivation starts.
    await new Promise((r) => setTimeout(r, 50));
    const result = await onComplete(full).catch(() => 'Erreur inattendue');
    if (typeof result === 'function') {
      setSuccess(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await new Promise((r) => setTimeout(r, GREEN_BEAT_MS));
      result();
      return;
    }
    const message = result;
    setBusy(false);
    // Always clear: on success the parent often shows the next step in this
    // same component instance, which must start empty.
    setCode('');
    if (message) {
      setError(message);
      display.current?.shake();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  function digit(d: string) {
    if (busy || code.length >= length) return;
    setError(null);
    const next = code + d;
    setCode(next);
    if (next.length === length) void submit(next);
  }

  const locked = wait > 0;
  return (
    <View style={styles.wrap}>
      <Text style={type.heading}>{title}</Text>
      {subtitle ? <Text style={[type.dim, styles.center]}>{subtitle}</Text> : null}
      <View style={styles.display}>
        <SafeDisplay
          ref={display}
          length={length}
          filled={busy ? length : code.length}
          state={success ? 'success' : busy ? 'busy' : error ? 'error' : 'idle'}
        />
      </View>
      <Text style={[styles.error, styles.center]}>
        {locked ? `Trop d'essais. Réessaie dans ${Math.ceil(wait / 1000)} s` : (error ?? ' ')}
      </Text>
      <PinPad
        onDigit={digit}
        onDelete={() => setCode((c) => c.slice(0, -1))}
        onClear={() => setCode('')}
        disabled={busy || locked}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md },
  display: { marginTop: space.md },
  error: { color: colors.danger, minHeight: 20, fontSize: 14 },
  center: { textAlign: 'center', paddingHorizontal: space.lg },
});
