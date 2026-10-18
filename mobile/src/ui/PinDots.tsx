import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors } from './theme';

export interface PinDotsHandle {
  shake(): void;
}

export const PinDots = forwardRef<PinDotsHandle, { length: number; filled: number; error?: boolean }>(
  function PinDots({ length, filled, error }, ref) {
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
    return (
      <Animated.View style={[styles.row, { transform: [{ translateX: x }] }]} accessibilityLabel={`${filled} chiffres sur ${length}`}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.dot, i < filled && styles.filled, error && styles.error]} />
        ))}
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 18 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.gold },
  filled: { backgroundColor: colors.gold },
  error: { borderColor: colors.danger, backgroundColor: 'transparent' },
});
