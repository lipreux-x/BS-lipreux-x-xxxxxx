import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, lcd, led, steel } from './theme';

export interface SafeDisplayHandle {
  shake(): void;
}

export type SafeDisplayState = 'idle' | 'busy' | 'success' | 'error';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * Safe-style backlit screen: one `-` per empty slot, `*` per typed digit
 * (never the digit itself), plus a status LED: dark idle, a pale filament
 * while the code is checked, sky blue when it is right (the whole display
 * flashes paler too), red on error.
 */
export const SafeDisplay = forwardRef<SafeDisplayHandle, { length: number; filled: number; state?: SafeDisplayState }>(
  function SafeDisplay({ length, filled, state = 'idle' }, ref) {
    const x = useRef(new Animated.Value(0)).current;
    useImperativeHandle(ref, () => ({
      shake() {
        x.setValue(0);
        Animated.sequence(
          [12, -12, 9, -9, 5, -5, 0].map((toValue) =>
            Animated.timing(x, { toValue, duration: 45, useNativeDriver: true }),
          ),
        ).start();
      },
    }));
    const error = state === 'error';
    const success = state === 'success';
    return (
      <Animated.View style={[styles.bezel, { transform: [{ translateX: x }] }]}>
        <View style={styles.screen} accessibilityLabel={`${filled} chiffres sur ${length}`}>
          {Array.from({ length }, (_, i) => (
            <Text
              key={i}
              style={[styles.char, i < filled ? styles.on : styles.off, error && styles.errorChar, success && styles.successChar]}
            >
              {i < filled ? '*' : '-'}
            </Text>
          ))}
        </View>
        <View style={[styles.led, state === 'busy' && styles.ledBusy, success && styles.ledSuccess, error && styles.ledError]} />
      </Animated.View>
    );
  },
);

const LCD_ON = lcd.on;
const BUSY = led.busy;
const OK = led.ok;

const styles = StyleSheet.create({
  bezel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 8,
    paddingRight: 14,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderTopColor: steel.bezelLight,
    borderLeftColor: steel.bezelLight,
    borderBottomColor: steel.bezelDark,
    borderRightColor: steel.bezelDark,
  },
  screen: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: lcd.glass,
    borderWidth: 2,
    borderTopColor: '#000000',
    borderLeftColor: '#000000',
    borderBottomColor: colors.border,
    borderRightColor: colors.border,
  },
  char: { fontFamily: MONO, fontSize: 30, width: 20, textAlign: 'center' },
  on: { color: LCD_ON, textShadowColor: LCD_ON, textShadowRadius: 6 },
  off: { color: lcd.off },
  errorChar: { color: colors.danger, textShadowColor: colors.danger },
  successChar: { color: lcd.flash, textShadowColor: lcd.flash },
  led: { width: 10, height: 10, borderRadius: 5, backgroundColor: led.off, borderWidth: 1, borderColor: '#000000' },
  ledBusy: { backgroundColor: BUSY, boxShadow: `0 0 6px ${BUSY}` },
  ledSuccess: { backgroundColor: OK, boxShadow: `0 0 6px ${OK}` },
  ledError: { backgroundColor: colors.danger, boxShadow: `0 0 6px ${colors.danger}` },
});
