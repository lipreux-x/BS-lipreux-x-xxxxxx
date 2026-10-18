import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { colors } from './theme';

/** The big breathing square of the lock screen. Tap: it opens, then `onOpen`. */
export function VaultSquare({ onOpen }: { onOpen(): void }) {
  const breath = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);

  function press() {
    Animated.timing(open, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(onOpen);
  }

  const scale = Animated.add(
    breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }),
    open.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }),
  );
  const opacity = open.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Pressable onPress={press} accessibilityRole="button" accessibilityLabel="Ouvrir BaseSecrète">
      <Animated.View style={[styles.square, { opacity, transform: [{ scale }] }]}>
        <View style={styles.inner}>
          <View style={styles.dial} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  square: {
    width: 180,
    height: 180,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.gold,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.gold,
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  inner: { width: 120, height: 120, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dial: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.gold },
});
