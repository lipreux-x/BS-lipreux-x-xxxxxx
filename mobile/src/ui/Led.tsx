import { StyleSheet, View } from 'react-native';
import { colors, led } from './theme';

export type LedState = 'off' | 'amber' | 'green' | 'red';

const GLOW = { amber: led.amber, green: led.green, red: colors.danger } as const;

/** Status LED, same as on the safe's code display: grey off, amber busy, green ok, red error. */
export function Led({ state, size = 8 }: { state: LedState; size?: number }) {
  const glow = state === 'off' ? null : GLOW[state];
  return (
    <View
      style={[
        styles.led,
        { width: size, height: size, borderRadius: size / 2 },
        glow && { backgroundColor: glow, shadowColor: glow, shadowOpacity: 0.9, shadowRadius: size / 2, shadowOffset: { width: 0, height: 0 } },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  led: { backgroundColor: '#2E2E2E', borderWidth: 1, borderColor: '#000000' },
});
