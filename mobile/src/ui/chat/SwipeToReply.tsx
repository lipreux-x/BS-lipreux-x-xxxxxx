import * as Haptics from 'expo-haptics';
import { Reply } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { colors, steel } from '../theme';

const TRIGGER = 56; // drag distance that answers the message
const MAX = 84;

/**
 * Drag a message to the left to answer it. The reply arrow fades in on the
 * right; past the trigger point the phone ticks once, and letting go answers.
 * Only clearly horizontal drags are taken, so the list still scrolls; to the
 * right, the drag goes back to the list (SwipeBack around the screen).
 */
export function SwipeToReply({ onReply, children }: { onReply?(): void; children: ReactNode }) {
  const [x] = useState(() => new Animated.Value(0));
  const armed = useRef(false);
  // The handler outlives renders: it reads the latest callback from a ref.
  const reply = useRef(onReply);
  useEffect(() => {
    reply.current = onReply;
  }, [onReply]);

  // Created once; the refs are only read while a drag runs, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => !!reply.current && g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        // Follows the finger, then resists past the trigger point.
        const dx = Math.max(0, -g.dx);
        x.setValue(-(dx <= TRIGGER ? dx : Math.min(MAX, TRIGGER + (dx - TRIGGER) * 0.3)));
        if (dx >= TRIGGER && !armed.current) {
          armed.current = true;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (dx < TRIGGER) {
          armed.current = false;
        }
      },
      onPanResponderRelease: () => {
        if (armed.current) reply.current?.();
        armed.current = false;
        Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      },
      onPanResponderTerminate: () => {
        armed.current = false;
        Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  );

  if (!onReply) return <>{children}</>;
  const iconOpacity = x.interpolate({ inputRange: [-TRIGGER, -TRIGGER * 0.4, 0], outputRange: [1, 0.4, 0], extrapolate: 'clamp' });
  const iconScale = x.interpolate({ inputRange: [-TRIGGER, 0], outputRange: [1, 0.6], extrapolate: 'clamp' });
  return (
    <View>
      <Animated.View pointerEvents="none" style={[styles.icon, { opacity: iconOpacity, transform: [{ scale: iconScale }] }]}>
        <Reply size={18} color={colors.text} strokeWidth={2} />
      </Animated.View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A small metal disc on the right, behind the message.
  icon: {
    position: 'absolute',
    right: 4,
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
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
