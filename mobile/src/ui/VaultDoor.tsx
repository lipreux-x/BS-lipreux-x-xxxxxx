import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors, space, type } from './theme';
import { VaultWall } from './VaultWall';

/** Frame size the styles are drawn at; the door scales up to fill the screen width. */
const BASE = 236;
const BOLTS = 8;
const TICKS = 40;

const METAL = '#24282B';
const LIGHT_EDGE = '#4A5056';
const DARK_EDGE = '#0A0B0C';
const STEEL = '#5A6168';
const GREEN = '#3DD68C';

function run(anim: Animated.CompositeAnimation) {
  return new Promise<void>((resolve) => anim.start(() => resolve()));
}

const t = (value: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.cubic)) =>
  Animated.timing(value, { toValue, duration, easing, useNativeDriver: true });

const deg = (v: Animated.Value) => v.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

/**
 * Lock screen vault door. On mount it slides in and its bolts lock with a
 * clunk. Tap: the combination dial spins, the wheel turns, the bolts retract,
 * the LED goes green and the door swings open on its hinge, then `onOpen`.
 */
export function VaultDoor({ onOpen, hint }: { onOpen(): void; hint?: string }) {
  // Animated values live in state, not refs: they are read while rendering.
  const [v] = useState(() => ({
    enter: new Animated.Value(0),
    bolts: new Animated.Value(1), // 0 = locked, 1 = retracted
    dial: new Animated.Value(0),
    wheel: new Animated.Value(0),
    unlocked: new Animated.Value(0),
    swing: new Animated.Value(0),
    exit: new Animated.Value(0),
    breath: new Animated.Value(0),
  }));
  const { enter, bolts, dial, wheel, unlocked, swing, exit, breath } = v;
  const { width, height } = useWindowDimensions();
  // Leave a band of wall visible around the door.
  const k = Math.min(width - 2 * space.lg, height * 0.5) / BASE;
  const styles = useMemo(() => makeStyles(k), [k]);
  const busy = useRef(false);
  const reduceMotion = useRef(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => (reduceMotion.current = r));

    const breathing = Animated.loop(Animated.sequence([t(breath, 1, 1600), t(breath, 0, 1600)]));
    void (async () => {
      await run(Animated.spring(enter, { toValue: 1, friction: 7, tension: 40, useNativeDriver: true }));
      if (!alive) return;
      await run(t(bolts, 0, 220, Easing.in(Easing.quad)));
      if (!alive) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      breathing.start();
    })();
    return () => {
      alive = false;
      breathing.stop();
    };
  }, [enter, bolts, breath]);

  async function press() {
    if (busy.current) return;
    busy.current = true;
    if (reduceMotion.current) {
      await run(t(exit, 1, 200));
      onOpen();
      return;
    }
    const tick = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Combination: right, left, right — a click at each stop.
    await run(t(dial, 300, 520));
    tick();
    await run(t(dial, 160, 360));
    tick();
    await run(t(dial, 250, 300));
    tick();

    // The wheel turns and pulls the bolts in.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await run(Animated.parallel([t(wheel, 90, 380), t(bolts, 1, 380, Easing.out(Easing.quad))]));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await run(t(unlocked, 1, 160));

    // The door swings on its left hinge, light pours out, then we step through.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await run(
      Animated.sequence([t(swing, 1, 650, Easing.inOut(Easing.cubic)), t(exit, 1, 260, Easing.in(Easing.quad))]),
    );
    onOpen();
  }

  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] });
  const frameStyle = {
    opacity: Animated.multiply(enter, exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
    transform: [
      {
        scale: Animated.multiply(
          breathScale,
          Animated.add(
            enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
            exit.interpolate({ inputRange: [0, 1], outputRange: [0, 1.5] }),
          ),
        ),
      },
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
    ],
  };
  const doorStyle = {
    transform: [
      { perspective: 900 * k },
      { rotateY: swing.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-105deg'] }) },
    ],
  };
  const boltOffset = bolts.interpolate({ inputRange: [0, 1], outputRange: [0, 14 * k] });
  const glow = swing.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.6, 1] });
  const wallOpacity = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const hintOpacity = Animated.multiply(
    enter,
    swing.interpolate({ inputRange: [0, 0.2], outputRange: [1, 0], extrapolate: 'clamp' }),
  );

  return (
    <View style={styles.wrap}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: wallOpacity }]}>
        <VaultWall width={width} height={height} />
      </Animated.View>
      <Pressable onPress={press} accessibilityRole="button" accessibilityLabel="Ouvrir BaseSecrète">
        <Animated.View style={[styles.frame, frameStyle]}>
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <View key={c} style={[styles.screw, styles[c]]}>
              <View style={styles.slot} />
            </View>
          ))}
          {(['hingeTop', 'hingeBottom'] as const).map((h) => (
            <View key={h} style={[styles.hinge, styles[h]]}>
              <View style={styles.hingePin} />
            </View>
          ))}
          <View style={styles.led}>
            <Animated.View style={[styles.ledOn, { opacity: unlocked }]} />
          </View>

          <View style={styles.recess}>
            {/* Inside the vault: light revealed as the door swings. */}
            <Animated.View style={[styles.inside, { opacity: glow }]}>
              <View style={styles.insideCore} />
            </Animated.View>

            <Animated.View style={[styles.door, { transformOrigin: 'left center' }, doorStyle]}>
              {Array.from({ length: BOLTS }, (_, i) => (
                <View key={i} style={[styles.ring, { transform: [{ rotate: `${(360 / BOLTS) * i}deg` }] }]}>
                  <Animated.View style={[styles.bolt, { transform: [{ translateY: boltOffset }] }]} />
                </View>
              ))}
              <View style={styles.doorFace}>
                <View style={styles.doorRing} />
                <Animated.View style={[styles.wheel, { transform: [{ rotate: deg(wheel) }] }]}>
                  {[0, 60, 120].map((a) => (
                    <View key={a} style={[styles.spoke, { transform: [{ rotate: `${a}deg` }] }]}>
                      <View style={styles.knob} />
                      <View style={styles.knob} />
                    </View>
                  ))}
                </Animated.View>
                <View style={styles.index} />
                <Animated.View style={[styles.dial, { transform: [{ rotate: deg(dial) }] }]}>
                  {Array.from({ length: TICKS }, (_, i) => (
                    <View key={i} style={[styles.tickRing, { transform: [{ rotate: `${(360 / TICKS) * i}deg` }] }]}>
                      <View style={[styles.tick, i % 5 === 0 && styles.tickMajor, i === 0 && styles.tickZero]} />
                    </View>
                  ))}
                  <View style={styles.hub} />
                </Animated.View>
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </Pressable>
      {hint ? (
        <Animated.View style={[styles.plate, { opacity: hintOpacity }]}>
          <View style={[styles.plateScrew, { left: 6 * k }]} />
          <Animated.Text style={[type.dim, styles.plateText]}>{hint}</Animated.Text>
          <View style={[styles.plateScrew, { right: 6 * k }]} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const bevel = {
  borderTopColor: LIGHT_EDGE,
  borderLeftColor: LIGHT_EDGE,
  borderBottomColor: DARK_EDGE,
  borderRightColor: DARK_EDGE,
};

/** Sizes are drawn for a BASE-wide frame and scaled by `k`. */
function makeStyles(k: number) {
  const FRAME = BASE * k;
  const RECESS = 210 * k;
  const DOOR = 186 * k;
  const WHEEL = 150 * k;
  const DIAL = 84 * k;
  return StyleSheet.create({
    wrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    // Engraved name plate under the door, holding the hint.
    plate: {
      marginTop: space.lg,
      paddingVertical: 8,
      paddingHorizontal: 28 * k,
      borderRadius: 4,
      backgroundColor: '#2A2F33',
      borderWidth: 1,
      ...bevel,
      justifyContent: 'center',
    },
    plateText: {
      color: colors.accentFg,
      letterSpacing: 2,
      textTransform: 'uppercase',
      fontSize: 12,
      fontWeight: '600',
    },
    plateScrew: {
      position: 'absolute',
      top: '50%',
      marginTop: -2.5,
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: DARK_EDGE,
    },
    // Door hinges on the frame's left edge, the side the door swings on.
    hinge: {
      position: 'absolute',
      left: -7 * k,
      width: 14 * k,
      height: 44 * k,
      borderRadius: 4 * k,
      backgroundColor: STEEL,
      borderWidth: 1 * k,
      ...bevel,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hingePin: { width: 4 * k, height: 34 * k, borderRadius: 2 * k, backgroundColor: '#3A3F44' },
    hingeTop: { top: 48 * k },
    hingeBottom: { bottom: 48 * k },
    frame: {
      width: FRAME,
      height: FRAME,
      borderRadius: 22 * k,
      backgroundColor: colors.surface2,
      borderWidth: 1.5 * k,
      ...bevel,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.accentFg,
      shadowOpacity: 0.25,
      shadowRadius: 28 * k,
      shadowOffset: { width: 0, height: 0 },
      elevation: 12,
    },
    screw: {
      position: 'absolute',
      width: 10 * k,
      height: 10 * k,
      borderRadius: 5 * k,
      backgroundColor: '#3A3F44',
      borderWidth: 1 * k,
      borderColor: DARK_EDGE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    slot: {
      width: 6 * k,
      height: 1.5 * k,
      backgroundColor: DARK_EDGE,
      transform: [{ rotate: '45deg' }],
    },
    tl: { top: 9 * k, left: 9 * k },
    tr: { top: 9 * k, right: 9 * k },
    bl: { bottom: 9 * k, left: 9 * k },
    br: { bottom: 9 * k, right: 9 * k },
    led: {
      position: 'absolute',
      top: 10 * k,
      alignSelf: 'center',
      width: 8 * k,
      height: 8 * k,
      borderRadius: 4 * k,
      backgroundColor: '#5A1E20',
      borderWidth: 1 * k,
      borderColor: '#000000',
    },
    ledOn: {
      flex: 1,
      borderRadius: 4 * k,
      backgroundColor: GREEN,
      shadowColor: GREEN,
      shadowOpacity: 0.9,
      shadowRadius: 6 * k,
      shadowOffset: { width: 0, height: 0 },
    },
    recess: {
      width: RECESS,
      height: RECESS,
      borderRadius: RECESS / 2,
      backgroundColor: '#050505',
      borderWidth: 2 * k,
      borderTopColor: DARK_EDGE,
      borderLeftColor: DARK_EDGE,
      borderBottomColor: '#33383C',
      borderRightColor: '#33383C',
      alignItems: 'center',
      justifyContent: 'center',
    },
    inside: {
      ...StyleSheet.absoluteFill,
      borderRadius: RECESS / 2,
      backgroundColor: '#1C2124',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    insideCore: {
      width: RECESS * 0.55,
      height: RECESS * 0.55,
      borderRadius: RECESS,
      backgroundColor: colors.accentFg,
      opacity: 0.35,
      shadowColor: '#FFFFFF',
      shadowOpacity: 0.8,
      shadowRadius: 40 * k,
      shadowOffset: { width: 0, height: 0 },
    },
    door: {
      width: DOOR,
      height: DOOR,
      alignItems: 'center',
      justifyContent: 'center',
      backfaceVisibility: 'hidden',
    },
    ring: { ...StyleSheet.absoluteFill, alignItems: 'center' },
    // Locked: sticks out of the door edge into the frame. Retracted: slides in.
    bolt: {
      marginTop: -9 * k,
      width: 12 * k,
      height: 22 * k,
      borderRadius: 3 * k,
      backgroundColor: STEEL,
      borderWidth: 1 * k,
      ...bevel,
    },
    doorFace: {
      width: DOOR,
      height: DOOR,
      borderRadius: DOOR / 2,
      backgroundColor: METAL,
      borderWidth: 2 * k,
      ...bevel,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doorRing: {
      position: 'absolute',
      width: DOOR - 22 * k,
      height: DOOR - 22 * k,
      borderRadius: DOOR,
      borderWidth: 1 * k,
      borderColor: '#1A1D1F',
    },
    wheel: {
      position: 'absolute',
      width: WHEEL,
      height: WHEEL,
      alignItems: 'center',
      justifyContent: 'center',
    },
    spoke: {
      position: 'absolute',
      width: WHEEL,
      height: 7 * k,
      borderRadius: 3.5 * k,
      backgroundColor: '#3A3F44',
      borderWidth: 1 * k,
      ...bevel,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    knob: {
      width: 16 * k,
      height: 16 * k,
      borderRadius: 8 * k,
      marginHorizontal: -5,
      backgroundColor: STEEL,
      borderWidth: 1 * k,
      ...bevel,
    },
    index: {
      position: 'absolute',
      top: (DOOR - DIAL) / 2 - 12 * k,
      width: 0,
      height: 0,
      borderLeftWidth: 5 * k,
      borderRightWidth: 5 * k,
      borderTopWidth: 8 * k,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: colors.danger,
    },
    dial: {
      width: DIAL,
      height: DIAL,
      borderRadius: DIAL / 2,
      backgroundColor: '#2E3337',
      borderWidth: 2 * k,
      ...bevel,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000000',
      shadowOpacity: 0.7,
      shadowRadius: 6 * k,
      shadowOffset: { width: 2 * k, height: 3 * k },
      elevation: 6,
    },
    tickRing: { ...StyleSheet.absoluteFill, alignItems: 'center', paddingTop: 2 * k },
    tick: { width: 1 * k, height: 5 * k, backgroundColor: colors.textDim },
    tickMajor: { width: 1.5 * k, height: 9 * k, backgroundColor: colors.accentFg },
    tickZero: { width: 2.5 * k, height: 10 * k, backgroundColor: colors.text },
    hub: {
      width: 34 * k,
      height: 34 * k,
      borderRadius: 17 * k,
      backgroundColor: METAL,
      borderWidth: 1.5 * k,
      borderTopColor: DARK_EDGE,
      borderLeftColor: DARK_EDGE,
      borderBottomColor: LIGHT_EDGE,
      borderRightColor: LIGHT_EDGE,
    },
  });
}
