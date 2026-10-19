import * as Haptics from 'expo-haptics';
import { FingerprintPattern } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Led, type LedState } from './Led';
import { colors, fonts, led, space } from './theme';

const SIZE = 148;
const ICON = 84;

type Phase = 'idle' | 'scanning' | 'open' | 'failed';

/**
 * The safe's fingerprint reader: a green-lit print on a metal plate. Tap it:
 * a scan line sweeps over the print while the phone checks the finger (the
 * system's own fingerprint sheet: no app can read the sensor itself), then
 * the LED goes green and the safe opens, or red with a shake.
 *
 * `onScan` resolves with `open` (called after the green beat) or null (cancelled / failed).
 */
export function FingerprintPad({ onScan }: { onScan(): Promise<(() => void) | null> }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [glow] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(0));
  const [shake] = useState(() => new Animated.Value(0));
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  // Waiting: the print breathes. Scanning: a line sweeps up and down over it.
  useEffect(() => {
    loop.current?.stop();
    if (phase === 'idle') {
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    } else if (phase === 'scanning') {
      sweep.setValue(0);
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(sweep, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(sweep, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
    } else {
      loop.current = null;
      glow.setValue(1);
    }
    loop.current?.start();
    return () => loop.current?.stop();
  }, [phase, glow, sweep]);

  async function scan() {
    if (phase === 'scanning' || phase === 'open') return;
    setPhase('scanning');
    void Haptics.selectionAsync();
    const open = await onScan();
    if (open) {
      setPhase('open');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(open, 450);
      return;
    }
    setPhase('failed');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    shake.setValue(0);
    Animated.sequence(
      [10, -10, 7, -7, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true })),
    ).start(() => setTimeout(() => setPhase('idle'), 500));
  }

  const tint = phase === 'failed' ? colors.danger : led.green;
  const ledState: LedState = phase === 'open' ? 'green' : phase === 'failed' ? 'red' : phase === 'scanning' ? 'amber' : 'off';
  const hint = { idle: 'Touche l’empreinte', scanning: 'Pose ton doigt sur le capteur', open: 'Ouvert', failed: 'Empreinte refusée' }[phase];

  return (
    <View style={styles.wrap}>
      <Led state={ledState} size={9} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir avec l’empreinte"
        onPress={() => void scan()}
        style={({ pressed }) => [styles.plate, pressed && styles.pressed]}
      >
        <Animated.View style={[styles.halo, { borderColor: tint, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.9] }) }]} />
        <Animated.View style={{ transform: [{ translateX: shake }] }}>
          <FingerprintPattern size={ICON} color={tint} strokeWidth={1.6} />
        </Animated.View>
        {phase === 'scanning' ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.line,
              { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [-ICON / 2, ICON / 2] }) }] },
            ]}
          />
        ) : null}
      </Pressable>
      <Text style={[styles.hint, phase === 'failed' && { color: colors.danger }]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md },
  plate: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15181B',
    borderWidth: 2,
    borderColor: '#2E3439',
    overflow: 'hidden',
    shadowColor: led.green,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  pressed: { transform: [{ scale: 0.97 }] },
  halo: { position: 'absolute', width: SIZE - 18, height: SIZE - 18, borderRadius: (SIZE - 18) / 2, borderWidth: 2 },
  line: {
    position: 'absolute',
    width: ICON + 20,
    height: 3,
    borderRadius: 2,
    backgroundColor: led.green,
    shadowColor: led.green,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  hint: { color: colors.textDim, fontFamily: fonts.medium, fontSize: 15, letterSpacing: 0.5 },
});
