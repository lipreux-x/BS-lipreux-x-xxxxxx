import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { calm, colors, led, space, type } from './theme';
import { BoltArt, DialArt, DialGloss, DoorFaceArt, FrameArt, Glow, HingeArt, SheenBand, WheelArt } from './VaultArt';
import { VaultWall } from './VaultWall';

/** Frame size the parts are drawn at; the door scales up to fill the screen width. */
const BASE = 236;
const BOLTS = 12;
/** Warm light inside the vault, the same tint as the code screen's `calm` glow. */
const WARM = '#FFCE8C';

/** Tunnel rings behind the door, by depth (the opening is at depth 1). */
const TUNNEL = [1.18, 1.4, 1.7, 2.15, 2.8, 3.8];
/**
 * The walk-in is a camera moving forward by TRAVEL: something at depth z then
 * looks z / (z - TRAVEL·e) times bigger. Sampled so Animated can interpolate it.
 */
const TRAVEL = 0.86;
const SAMPLES = [0, 0.15, 0.3, 0.45, 0.6, 0.72, 0.82, 0.9, 0.96, 1];
const grow = (z: number) => SAMPLES.map((e) => z / (z - e * TRAVEL));

function run(anim: Animated.CompositeAnimation) {
  return new Promise<void>((resolve) => anim.start(() => resolve()));
}

const t = (value: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.cubic)) =>
  Animated.timing(value, { toValue, duration, easing, useNativeDriver: true });

const deg = (v: Animated.Value) => v.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

/**
 * Lock screen vault door. On mount it rises into place and its bolts slam shut
 * one after the other; while it waits, a glint sweeps across it and the red LED
 * pulses. Tap: the combination dial clicks through three numbers, the handwheel
 * turns and draws the bolts in one by one, the LED goes green, the door unseats
 * with a thud and swings open on its hinges, light spills out, and the camera
 * walks through the opening down a lit tunnel until the code screen's `calm`
 * backdrop fills the screen. Then `onOpen`, with nothing left to cross-fade.
 */
export function VaultDoor({ onOpen, hint }: { onOpen(): void; hint?: string }) {
  // Animated values live in state, not refs: they are read while rendering.
  const [v] = useState(() => ({
    enter: new Animated.Value(0),
    press: new Animated.Value(0), // finger down
    bolts: new Animated.Value(1), // 0 = locked, 1 = retracted
    dial: new Animated.Value(0),
    wheel: new Animated.Value(0),
    unlocked: new Animated.Value(0),
    shake: new Animated.Value(0),
    pull: new Animated.Value(0), // door unseats towards us before swinging
    swing: new Animated.Value(0),
    exit: new Animated.Value(0), // 0 = at the door, 1 = inside
    fade: new Animated.Value(0), // reduced motion: cross-fade instead of the walk-in
    pulse: new Animated.Value(0),
    sheen: new Animated.Value(0),
  }));
  const { enter, press, bolts, dial, wheel, unlocked, shake, pull, swing, exit, fade, pulse, sheen } = v;
  const { width, height } = useWindowDimensions();
  // Leave a band of wall visible around the door.
  const k = Math.min(width - 2 * space.lg, height * 0.5) / BASE;
  const styles = useMemo(() => makeStyles(k), [k]);
  const busy = useRef(false);
  const idle = useRef<Animated.CompositeAnimation | null>(null);
  const reduceMotion = useRef(false);

  const thud = (amp: number) =>
    Animated.sequence([
      t(shake, amp * k, 40, Easing.out(Easing.quad)),
      t(shake, -amp * 0.6 * k, 60),
      t(shake, amp * 0.3 * k, 60),
      t(shake, 0, 80),
    ]);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => (reduceMotion.current = r));

    void (async () => {
      await run(Animated.spring(enter, { toValue: 1, friction: 8, tension: 38, useNativeDriver: true }));
      if (!alive) return;
      await run(t(bolts, 0, 420, Easing.in(Easing.quad)));
      if (!alive) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      thud(2).start();
      idle.current = Animated.parallel([
        Animated.loop(Animated.sequence([t(pulse, 1, 900), t(pulse, 0, 900)])),
        Animated.loop(
          Animated.sequence([
            Animated.delay(1600),
            t(sheen, 1, 1300, Easing.inOut(Easing.quad)),
            Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: true }),
            Animated.delay(1800),
          ]),
        ),
      ]);
      if (!busy.current) idle.current.start();
    })();
    return () => {
      alive = false;
      idle.current?.stop();
    };
    // `thud` only closes over stable Animated values and `k`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enter, bolts, pulse, sheen]);

  async function open() {
    if (busy.current) return;
    busy.current = true;
    idle.current?.stop();
    Animated.parallel([t(sheen, 0, 150), t(press, 0, 150)]).start();
    if (reduceMotion.current) {
      await run(t(fade, 1, 200));
      onOpen();
      return;
    }
    const click = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const settle = Easing.out(Easing.cubic);

    // Combination: right, left, right — the dial slows into each number and clicks.
    await run(t(dial, 280, 480, settle));
    click();
    await run(t(dial, 140, 380, settle));
    click();
    await run(t(dial, 210, 300, settle));
    click();

    // The handwheel turns and draws the bolts in, one after the other.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await run(
      Animated.parallel([
        t(wheel, 135, 560, Easing.inOut(Easing.back(1.2))),
        t(bolts, 1, 560, Easing.inOut(Easing.quad)),
      ]),
    );
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await run(Animated.parallel([t(unlocked, 1, 140), thud(3)]));

    // The seal breaks: the heavy door comes towards us a little...
    await run(t(pull, 1, 260, Easing.out(Easing.cubic)));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // ...swings open on its hinges, and before it has finished we're already walking in.
    await run(
      Animated.parallel([
        t(swing, 1, 760, Easing.inOut(Easing.cubic)),
        Animated.sequence([Animated.delay(480), t(exit, 1, 1050, Easing.inOut(Easing.sin))]),
      ]),
    );
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    onOpen();
  }

  const unfade = fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const frameStyle = {
    opacity: Animated.multiply(enter, unfade),
    transform: [
      { translateX: shake },
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) },
      {
        scale: Animated.multiply(
          Animated.multiply(
            enter.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }),
            press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.975] }),
          ),
          exit.interpolate({ inputRange: SAMPLES, outputRange: grow(1) }),
        ),
      },
    ],
  };
  // The door: unseats (scales about its centre), then swings about its left edge, darkening as it turns away.
  const pullStyle = { transform: [{ scale: pull.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) }] };
  const doorStyle = {
    transformOrigin: 'left center',
    transform: [
      { perspective: 1000 * k },
      { rotateY: swing.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-112deg'] }) },
    ],
  } as const;
  const doorShade = swing.interpolate({ inputRange: [0, 1], outputRange: [0, 0.75] });
  const doorShadowStyle = {
    opacity: Animated.multiply(pull, swing.interpolate({ inputRange: [0, 0.4], outputRange: [0.7, 0], extrapolate: 'clamp' })),
    transform: [{ translateX: Animated.multiply(pull, 4 * k) }, { translateY: Animated.multiply(pull, 7 * k) }],
  };
  const boltOffset = (i: number) => {
    const start = (i / BOLTS) * 0.45;
    return bolts.interpolate({ inputRange: [start, start + 0.55], outputRange: [0, 14 * k], extrapolate: 'clamp' });
  };
  const sheenX = sheen.interpolate({ inputRange: [0, 1], outputRange: [-1.1 * 186 * k, 1.1 * 186 * k] });

  // Light: revealed through the gap as the door swings, spilling onto the frame and the wall.
  const light = swing.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0.65, 1] });
  const spill = Animated.multiply(light, exit.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }));
  // The wall slides past slower than the door (parallax) and is gone once we're through.
  const wallStyle = {
    opacity: Animated.multiply(exit.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }), unfade),
    transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
  };
  // Tunnel rings: each grows by its own depth relative to the opening, so the far ones lag behind.
  const ringStyle = (z: number) => ({
    transform: [
      {
        scale: exit.interpolate({
          inputRange: SAMPLES,
          outputRange: grow(z).map((g, i) => g / grow(1)[i]! / z),
        }),
      },
    ],
  });
  // Last stretch: the end-of-tunnel light settles into the code screen's backdrop.
  const arrive = exit.interpolate({ inputRange: [0.78, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const hintOpacity = Animated.multiply(
    enter,
    swing.interpolate({ inputRange: [0, 0.15], outputRange: [1, 0], extrapolate: 'clamp' }),
  );

  return (
    <View style={styles.wrap}>
      <Animated.View style={[StyleSheet.absoluteFill, wallStyle]}>
        <VaultWall width={width} height={height} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.wallGlow, { opacity: Animated.multiply(spill, 0.55) }]}>
        <Glow size={styles.wallGlow.width} color={WARM} strength={0.5} />
      </Animated.View>

      <Pressable
        onPress={open}
        onPressIn={() => !busy.current && t(press, 1, 90, Easing.out(Easing.quad)).start()}
        onPressOut={() => !busy.current && Animated.spring(press, { toValue: 0, friction: 4, useNativeDriver: true }).start()}
        accessibilityRole="button"
        accessibilityLabel="Ouvrir BaseSecrète"
      >
        <Animated.View style={[styles.frame, frameStyle]}>
          <View style={StyleSheet.absoluteFill}>
            <FrameArt size={styles.frame.width} />
          </View>
          <Animated.View pointerEvents="none" style={[styles.frameGlow, { opacity: Animated.multiply(spill, 0.7) }]}>
            <Glow size={styles.frameGlow.width} color={WARM} strength={0.45} />
          </Animated.View>
          {(['hingeTop', 'hingeBottom'] as const).map((h) => (
            <View key={h} style={[styles.hinge, styles[h]]}>
              <HingeArt width={styles.hinge.width} height={styles.hinge.height} />
            </View>
          ))}
          <View style={styles.led}>
            <Animated.View style={[styles.ledRed, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }]} />
            <Animated.View style={[styles.ledGreen, { opacity: unlocked }]} />
          </View>

          <View style={styles.recess}>
            {/* Inside the vault: a lit tunnel, revealed as the door swings. */}
            <Animated.View style={[styles.inside, { opacity: light }]}>
              {TUNNEL.map((z) => (
                <Animated.View key={z} style={[styles.tunnelRing, ringStyle(z)]} />
              ))}
              <View style={styles.tunnelEnd}>
                <Glow size={styles.tunnelEnd.width} color={WARM} strength={0.55} />
              </View>
            </Animated.View>

            <Animated.View style={[styles.doorShadow, doorShadowStyle]} />
            <Animated.View style={pullStyle}>
              <Animated.View style={[styles.door, doorStyle]}>
                {Array.from({ length: BOLTS }, (_, i) => (
                  <View key={i} style={[styles.ring, { transform: [{ rotate: `${(360 / BOLTS) * i}deg` }] }]}>
                    <Animated.View style={[styles.bolt, { transform: [{ translateY: boltOffset(i) }] }]}>
                      <BoltArt width={styles.bolt.width} height={styles.bolt.height} />
                    </Animated.View>
                  </View>
                ))}
                <View style={styles.face}>
                  <DoorFaceArt size={styles.face.width} />
                </View>
                <Animated.View style={[styles.wheel, styles.wheelShadow, { transform: [{ translateX: 2.5 * k }, { translateY: 4 * k }, { rotate: deg(wheel) }] }]}>
                  <WheelArt size={styles.wheel.width} shadow />
                </Animated.View>
                <Animated.View style={[styles.wheel, { transform: [{ rotate: deg(wheel) }] }]}>
                  <WheelArt size={styles.wheel.width} />
                </Animated.View>
                <View style={styles.dialShadow} />
                <Animated.View style={[styles.dial, { transform: [{ rotate: deg(dial) }] }]}>
                  <DialArt size={styles.dial.width} />
                </Animated.View>
                <View style={styles.dial} pointerEvents="none">
                  <DialGloss size={styles.dial.width} />
                </View>
                <View style={styles.index} />
                <View style={styles.sheenClip} pointerEvents="none">
                  <Animated.View style={[styles.sheen, { transform: [{ translateX: sheenX }, { rotate: '22deg' }] }]}>
                    <SheenBand width={styles.sheen.width} height={styles.sheen.height} />
                  </Animated.View>
                </View>
                <Animated.View style={[styles.face, styles.shade, { opacity: doorShade }]} pointerEvents="none" />
              </Animated.View>
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
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, calm, { opacity: arrive }]} />
    </View>
  );
}

/** Sizes are drawn for a BASE-wide frame and scaled by `k`. */
function makeStyles(k: number) {
  const FRAME = BASE * k;
  const RECESS = 210 * k;
  const DOOR = 186 * k;
  const WHEEL = 150 * k;
  const DIAL = 84 * k;
  const circle = (d: number) => ({ width: d, height: d, borderRadius: d / 2 });
  const centred = (d: number) => ({ position: 'absolute' as const, ...circle(d), left: (DOOR - d) / 2, top: (DOOR - d) / 2 });
  return StyleSheet.create({
    wrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
    wallGlow: { position: 'absolute', width: FRAME * 2.2, height: FRAME * 2.2 },
    // Engraved name plate under the door, holding the hint.
    plate: {
      marginTop: space.lg,
      paddingVertical: 8,
      paddingHorizontal: 28 * k,
      borderRadius: 4,
      backgroundColor: '#2A2F33',
      borderWidth: 1,
      borderTopColor: '#5A6168',
      borderLeftColor: '#5A6168',
      borderBottomColor: '#0A0B0C',
      borderRightColor: '#0A0B0C',
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
      backgroundColor: '#0A0B0C',
    },
    frame: {
      width: FRAME,
      height: FRAME,
      borderRadius: 22 * k,
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: [
        { offsetX: 0, offsetY: 18 * k, blurRadius: 36 * k, color: 'rgba(0,0,0,0.75)' },
        { offsetX: 0, offsetY: 0, blurRadius: 30 * k, color: 'rgba(154,161,167,0.18)' },
      ],
    },
    frameGlow: { position: 'absolute', width: FRAME * 1.25, height: FRAME * 1.25 },
    // Door hinges on the frame's left edge, the side the door swings on.
    hinge: { position: 'absolute', left: -7 * k, width: 14 * k, height: 44 * k },
    hingeTop: { top: 50 * k },
    hingeBottom: { bottom: 50 * k },
    // Status LED in the top-right corner of the frame.
    led: {
      position: 'absolute',
      top: 24 * k,
      right: 26 * k,
      ...circle(9 * k),
      backgroundColor: '#2A0D0E',
      borderWidth: 1 * k,
      borderColor: '#000000',
      overflow: 'visible',
    },
    ledRed: {
      ...StyleSheet.absoluteFill,
      borderRadius: 4.5 * k,
      backgroundColor: colors.danger,
      boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 8 * k, color: colors.danger }],
    },
    ledGreen: {
      ...StyleSheet.absoluteFill,
      borderRadius: 4.5 * k,
      backgroundColor: led.green,
      boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 10 * k, color: led.green }],
    },
    recess: { ...circle(RECESS), alignItems: 'center', justifyContent: 'center' },
    inside: {
      ...StyleSheet.absoluteFill,
      borderRadius: RECESS / 2,
      backgroundColor: calm.backgroundColor,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    // Drawn at the opening's size; `ringStyle` shrinks each one to its depth.
    tunnelRing: {
      position: 'absolute',
      ...circle(RECESS),
      borderWidth: 3 * k,
      borderColor: 'rgba(255,206,140,0.10)',
      backgroundColor: 'rgba(255,206,140,0.035)',
    },
    tunnelEnd: { position: 'absolute', width: RECESS * 0.9, height: RECESS * 0.9 },
    doorShadow: { position: 'absolute', ...circle(DOOR), backgroundColor: '#000000' },
    door: { ...circle(DOOR), backfaceVisibility: 'hidden' },
    ring: { ...StyleSheet.absoluteFill, alignItems: 'center' },
    // Locked: sticks out of the door edge into the frame. Retracted: slides in under the face.
    bolt: { marginTop: -9 * k, width: 12 * k, height: 24 * k },
    face: { ...centred(DOOR) },
    shade: { backgroundColor: '#000000' },
    wheel: { ...centred(WHEEL) },
    wheelShadow: { opacity: 0.45 },
    dialShadow: {
      ...centred(DIAL),
      boxShadow: [{ offsetX: 2 * k, offsetY: 4 * k, blurRadius: 7 * k, color: 'rgba(0,0,0,0.8)' }],
    },
    dial: { ...centred(DIAL) },
    // Red index above the dial: the number under it is the one dialled.
    index: {
      position: 'absolute',
      top: (DOOR - DIAL) / 2 - 7 * k,
      left: DOOR / 2 - 4.5 * k,
      width: 0,
      height: 0,
      borderLeftWidth: 4.5 * k,
      borderRightWidth: 4.5 * k,
      borderTopWidth: 7 * k,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: colors.danger,
    },
    sheenClip: { ...centred(DOOR), overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    sheen: { width: 46 * k, height: DOOR * 1.6 },
  });
}
