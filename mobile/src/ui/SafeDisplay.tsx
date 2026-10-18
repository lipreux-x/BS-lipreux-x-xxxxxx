import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export interface SafeDisplayHandle {
  shake(): void;
}

export type SafeDisplayState = 'idle' | 'busy' | 'error';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * Safe-style backlit screen: one `-` per empty slot, `*` per typed digit
 * (never the digit itself), plus a status LED: grey idle, amber while the
 * code is checked, red on error.
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
    return (
      <Animated.View style={[styles.bezel, { transform: [{ translateX: x }] }]}>
        <View style={styles.screen} accessibilityLabel={`${filled} chiffres sur ${length}`}>
          {Array.from({ length }, (_, i) => (
            <Text key={i} style={[styles.char, i < filled ? styles.on : styles.off, error && styles.errorChar]}>
              {i < filled ? '*' : '-'}
            </Text>
          ))}
        </View>
        <View style={[styles.led, state === 'busy' && styles.ledBusy, error && styles.ledError]} />
      </Animated.View>
    );
  },
);

const LCD_ON = '#C8D3C0';
const AMBER = '#E8A33D';

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
    borderTopColor: '#3A3A3A',
    borderLeftColor: '#3A3A3A',
    borderBottomColor: '#050505',
    borderRightColor: '#050505',
  },
  screen: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: '#0B100C',
    borderWidth: 2,
    borderTopColor: '#000000',
    borderLeftColor: '#000000',
    borderBottomColor: colors.border,
    borderRightColor: colors.border,
  },
  char: { fontFamily: MONO, fontSize: 30, width: 20, textAlign: 'center' },
  on: { color: LCD_ON, textShadowColor: LCD_ON, textShadowRadius: 6 },
  off: { color: '#26302A' },
  errorChar: { color: colors.danger, textShadowColor: colors.danger },
  led: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E2E2E', borderWidth: 1, borderColor: '#000000' },
  ledBusy: { backgroundColor: AMBER, shadowColor: AMBER, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  ledError: { backgroundColor: colors.danger, shadowColor: colors.danger, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
});
