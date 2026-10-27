import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Logo } from './Logo';
import { colors, fonts, space } from './theme';

/**
 * A line and, under it in the middle, the blade of the logo turning: what the
 * phone is busy with (deriving a key, decrypting). Without `label`, the blade
 * alone (a short wait that is not crypto). Fills its parent. The turn
 * runs on the native driver: the crypto keeps the JS thread busy meanwhile, a
 * JS animation would freeze.
 */
export function Working({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={[StyleSheet.absoluteFill, styles.working, style]} accessibilityRole="progressbar" accessibilityLabel={label ?? 'Chargement'}>
      {label ? <Text style={styles.text}>{label}</Text> : null}
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Logo width={88} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  working: { alignItems: 'center', justifyContent: 'center', gap: space.lg },
  text: { color: colors.text, fontFamily: fonts.medium, fontSize: 16, textAlign: 'center' },
});
