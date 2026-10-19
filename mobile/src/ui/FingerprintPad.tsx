import * as Haptics from 'expo-haptics';
import { FingerprintPattern } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, led } from './theme';

/** Sensor window: a square of dark glass set into the plate. */
const WINDOW = 172;
const ICON = 104;
const GRID_STEP = 11;
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const METAL = '#24282B';
const LIGHT_EDGE = '#4A5056';
const DARK_EDGE = '#0A0B0C';
const GLASS = '#070B08';
const LCD_ON = '#C8D3C0';
const GRID = 'rgba(61, 214, 140, 0.10)';

type Phase = 'idle' | 'scanning' | 'open' | 'failed';

const STATUS: Record<Phase, string> = { idle: 'PRÊT', scanning: 'LECTURE…', open: 'ACCÈS OK', failed: 'REFUSÉ' };
const HINT: Record<Phase, string> = {
  idle: 'Pose ton doigt sur le lecteur',
  scanning: 'Garde ton doigt sur le capteur du téléphone',
  open: 'Ouverture',
  failed: 'Empreinte refusée, réessaie',
};

/**
 * The safe's biometric reader, in the keypad's look: a screwed metal plate,
 * a square sensor window of dark glass with a green backlight, a grid and
 * aiming corners, and a small LCD status line with its LED.
 *
 * Touch the window: it lights up, a scan bar sweeps down over the print
 * while the phone checks the finger (on the system's own fingerprint sheet:
 * no app can read the sensor itself), then the window flashes green and the
 * safe opens, or red with a shake.
 *
 * `onScan` resolves with `open` (called after the green flash) or null (cancelled / failed).
 */
export function FingerprintPad({ onScan }: { onScan(): Promise<(() => void) | null> }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [pulse] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(0));
  const [flash] = useState(() => new Animated.Value(0));
  const [shake] = useState(() => new Animated.Value(0));
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  // Waiting: the backlight breathes. Reading: the scan bar sweeps top to bottom, again and again.
  useEffect(() => {
    loop.current?.stop();
    loop.current = null;
    if (phase === 'idle') {
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    } else if (phase === 'scanning') {
      pulse.setValue(1);
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(sweep, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
          Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    }
    loop.current?.start();
    return () => loop.current?.stop();
  }, [phase, pulse, sweep]);

  async function scan() {
    if (phase === 'scanning' || phase === 'open') return;
    sweep.setValue(0);
    setPhase('scanning');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const open = await onScan();
    const ok = !!open;
    setPhase(ok ? 'open' : 'failed');
    void Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
    flash.setValue(1);
    Animated.timing(flash, { toValue: ok ? 0.35 : 0, duration: ok ? 420 : 700, useNativeDriver: true }).start();
    if (ok) {
      setTimeout(open, 500);
      return;
    }
    shake.setValue(0);
    Animated.sequence([12, -12, 8, -8, 4, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 50, useNativeDriver: true }))).start(() =>
      setTimeout(() => setPhase('idle'), 600),
    );
  }

  const failed = phase === 'failed';
  const tint = failed ? colors.danger : led.green;
  const ledColor = phase === 'open' ? led.green : failed ? colors.danger : phase === 'scanning' ? led.amber : null;
  const backlight = pulse.interpolate({ inputRange: [0, 1], outputRange: phase === 'scanning' ? [0.5, 0.5] : [0.12, 0.3] });
  const printOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: phase === 'idle' ? [0.55, 0.85] : [1, 1] });

  return (
    <Animated.View style={[styles.plate, { transform: [{ translateX: shake }] }]}>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} style={[styles.screw, styles[c]]}>
          <View style={styles.slot} />
        </View>
      ))}

      <Text style={styles.engraving}>LECTEUR BIOMÉTRIQUE</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir avec l’empreinte"
        onPress={() => void scan()}
        style={({ pressed }) => [styles.bezel, pressed && styles.bezelPressed]}
      >
        <View style={styles.window}>
          {/* Backlight, grid and aiming corners: the sensor glass. */}
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: backlight }]} />
          {Array.from({ length: Math.floor(WINDOW / GRID_STEP) }, (_, i) => (
            <View key={`h${i}`} style={[styles.row, { top: (i + 1) * GRID_STEP }]} />
          ))}
          {Array.from({ length: Math.floor(WINDOW / GRID_STEP) }, (_, i) => (
            <View key={`v${i}`} style={[styles.column, { left: (i + 1) * GRID_STEP }]} />
          ))}
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <View key={c} style={[styles.corner, cornerStyles[c], { borderColor: tint }]} />
          ))}

          <Animated.View style={{ opacity: printOpacity }}>
            <FingerprintPattern size={ICON} color={tint} strokeWidth={1.4} />
          </Animated.View>

          {phase === 'scanning' ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.scan, { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [-14, WINDOW] }) }] }]}
            >
              <View style={styles.trail} />
              <View style={styles.bar} />
            </Animated.View>
          ) : null}

          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: flash }]} />
        </View>
      </Pressable>

      <View style={styles.lcdBezel}>
        <View style={styles.lcd}>
          <Text style={[styles.lcdText, failed && { color: colors.danger }, phase === 'open' && { color: led.green }]}>{STATUS[phase]}</Text>
        </View>
        <View
          style={[
            styles.led,
            ledColor && { backgroundColor: ledColor, shadowColor: ledColor, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
          ]}
        />
      </View>

      <Text style={[styles.hint, failed && { color: colors.danger }]}>{HINT[phase]}</Text>
    </Animated.View>
  );
}

const CORNER = 22;
const cornerStyles = StyleSheet.create({
  tl: { top: 8, left: 8, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 },
  tr: { top: 8, right: 8, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 },
  bl: { bottom: 8, left: 8, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 },
  br: { bottom: 8, right: 8, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 },
});

const styles = StyleSheet.create({
  // Same plate as the keypad: bevelled, four screws.
  plate: {
    width: 296,
    alignItems: 'center',
    gap: 16,
    paddingVertical: 22,
    paddingHorizontal: 22,
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
  engraving: { color: '#5A6168', fontFamily: MONO, fontSize: 11, letterSpacing: 3 },

  // Metal frame around the glass, bevelled like a key; pressed: pushed in.
  bezel: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: METAL,
    borderWidth: 2,
    borderTopColor: LIGHT_EDGE,
    borderLeftColor: LIGHT_EDGE,
    borderBottomColor: DARK_EDGE,
    borderRightColor: DARK_EDGE,
  },
  bezelPressed: {
    borderTopColor: DARK_EDGE,
    borderLeftColor: DARK_EDGE,
    borderBottomColor: LIGHT_EDGE,
    borderRightColor: LIGHT_EDGE,
    transform: [{ translateY: 1 }],
  },
  window: {
    width: WINDOW,
    height: WINDOW,
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GLASS,
    borderWidth: 2,
    borderTopColor: '#000000',
    borderLeftColor: '#000000',
    borderBottomColor: colors.border,
    borderRightColor: colors.border,
  },
  row: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: GRID },
  column: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: GRID },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  scan: { position: 'absolute', top: 0, left: 0, right: 0, height: 14 },
  trail: { height: 11, backgroundColor: 'rgba(61, 214, 140, 0.18)' },
  bar: {
    height: 3,
    backgroundColor: led.green,
    shadowColor: led.green,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },

  // Status line: the code display's LCD and LED.
  lcdBezel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 6,
    paddingRight: 12,
    borderRadius: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderTopColor: '#3A3A3A',
    borderLeftColor: '#3A3A3A',
    borderBottomColor: '#050505',
    borderRightColor: '#050505',
  },
  lcd: {
    width: 150,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#0B100C',
    borderWidth: 2,
    borderTopColor: '#000000',
    borderLeftColor: '#000000',
    borderBottomColor: colors.border,
    borderRightColor: colors.border,
  },
  lcdText: { color: LCD_ON, fontFamily: MONO, fontSize: 15, letterSpacing: 2 },
  led: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E2E2E', borderWidth: 1, borderColor: '#000000' },
  hint: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
});
