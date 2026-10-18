import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PinPad } from './PinPad';
import { SafeDisplay, type SafeDisplayHandle } from './SafeDisplay';
import { colors, space, type } from './theme';

/**
 * Title + safe display + safe keypad. `onComplete` returns null on success or
 * an error message to show (the display shakes and resets). While it runs, the
 * pad is disabled and the display's LED turns amber: Argon2id takes a moment
 * on the phone.
 */
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
  onComplete(code: string): Promise<string | null>;
  lockedForMs?: number;
  /** Shown until the first key press, e.g. "codes do not match" from the previous step. */
  initialError?: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [wait, setWait] = useState(lockedForMs);
  const display = useRef<SafeDisplayHandle>(null);

  useEffect(() => setWait(lockedForMs), [lockedForMs]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => Math.max(0, w - 1000)), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(full: string) {
    setBusy(true);
    // Let the spinner render before the (synchronous) key derivation starts.
    await new Promise((r) => setTimeout(r, 50));
    const message = await onComplete(full).catch(() => 'Erreur inattendue');
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
          state={busy ? 'busy' : error ? 'error' : 'idle'}
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
