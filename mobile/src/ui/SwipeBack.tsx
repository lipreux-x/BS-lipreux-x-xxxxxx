import * as Haptics from 'expo-haptics';
import { ChevronLeft } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { colors, steel } from './theme';

const TRIGGER = 72; // drag distance that goes back
const MAX = 96;
const FLICK = 0.6; // px/ms: a quick flick goes back even short of the trigger

/**
 * Drag the screen to the right to go back, anywhere on it (not only from the
 * edge). The screen follows the finger, a back arrow fades in on the left;
 * past the trigger point the phone ticks once, and letting go goes back.
 * Only clearly horizontal drags to the right are taken, and only those no
 * child took first (a message dragged to the left answers it, see SwipeToReply).
 */
export function SwipeBack({ onBack, children }: { onBack(): void; children: ReactNode }) {
  const [x] = useState(() => new Animated.Value(0));
  const armed = useRef(false);
  // The handler outlives renders: it reads the latest callback from a ref.
  const back = useRef(onBack);
  useEffect(() => {
    back.current = onBack;
  }, [onBack]);

  // Created once; the refs are only read while a drag runs, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        // Follows the finger, then resists past the trigger point.
        const dx = Math.max(0, g.dx);
        x.setValue(dx <= TRIGGER ? dx : Math.min(MAX, TRIGGER + (dx - TRIGGER) * 0.3));
        if (dx >= TRIGGER && !armed.current) {
          armed.current = true;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (dx < TRIGGER) {
          armed.current = false;
        }
      },
      onPanResponderRelease: (_e, g) => {
        const go = armed.current || (g.vx > FLICK && g.dx > TRIGGER / 2);
        armed.current = false;
        Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 24 }).start();
        if (go) back.current();
      },
      onPanResponderTerminate: () => {
        armed.current = false;
        Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  );

  const iconOpacity = x.interpolate({ inputRange: [0, TRIGGER * 0.4, TRIGGER], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  const iconScale = x.interpolate({ inputRange: [0, TRIGGER], outputRange: [0.6, 1], extrapolate: 'clamp' });
  return (
    <View style={styles.wrap} {...pan.panHandlers}>
      <Animated.View style={[styles.wrap, { transform: [{ translateX: x }] }]}>{children}</Animated.View>
      <Animated.View pointerEvents="none" style={[styles.icon, { opacity: iconOpacity, transform: [{ scale: iconScale }] }]}>
        <ChevronLeft size={22} color={colors.text} strokeWidth={2.25} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  // A small metal disc on the left edge, over the screen sliding away.
  icon: {
    position: 'absolute',
    left: 12,
    top: '45%',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: steel.key,
    borderWidth: 1,
    borderTopColor: steel.edgeLight,
    borderLeftColor: steel.edgeLight,
    borderBottomColor: steel.edgeDark,
    borderRightColor: steel.edgeDark,
  },
});
