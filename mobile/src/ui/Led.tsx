import { StyleSheet, View } from 'react-native';
import { led } from './theme';

export type LedState = 'off' | 'busy' | 'ok' | 'error';

/**
 * Status LED, same as on the safe's code display: dark off, a pale filament
 * while something is being done, sky blue when it is right or open, neon
 * red on an error or something shut.
 */
export function Led({ state, size = 8 }: { state: LedState; size?: number }) {
  const glow = state === 'off' ? null : led[state];
  return (
    <View
      style={[
        styles.led,
        { width: size, height: size, borderRadius: size / 2 },
        glow && { backgroundColor: glow, boxShadow: `0 0 ${size / 2}px ${glow}` },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  led: { backgroundColor: led.off, borderWidth: 1, borderColor: '#000000' },
});
