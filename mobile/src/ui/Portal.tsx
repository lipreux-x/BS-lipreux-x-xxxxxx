import { memo, useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { blob, BUBBLES, CORE_STROKES, DARK_STROKES, LIGHT_STROKES, MID_STROKES } from './portalShapes';

/** Portal light, also spilled onto the frame and the wall as the door opens. */
export const PORTAL_GLOW = '#7CFF5B';

/** One turn of the currents; the centre turns twice as fast. */
const SWIRL_MS = 2600;
/** One turn of the bubbles (and, the other way, of the liquid edge): slower than the currents. */
const DRIFT_MS = 4200;
/** Black hole's diameter, as a share of the portal's. */
const HOLE = 0.44;

const Shapes = ({ paths, fill, opacity = 1 }: { paths: string[]; fill: string; opacity?: number }) =>
  paths.map((d) => <Path key={d} d={d} fill={fill} fillOpacity={opacity} />);

/** Liquid edge: bright lime rim with a soft halo, around the green body. */
const Rim = memo(function Rim({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="ptBody" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#1E6A15" />
          <Stop offset="0.55" stopColor="#3E9F27" />
          <Stop offset="1" stopColor="#5CC530" />
        </RadialGradient>
      </Defs>
      <Path d={blob(48.5, 1.6)} fill="#A6F24E" fillOpacity={0.35} />
      <Path d={blob(46.5, 2.2, 1)} fill="#8CE639" />
      <Path d={blob(42.5, 1.6, 2)} fill="url(#ptBody)" />
    </Svg>
  );
});

/** The swirl's currents: wide dark ones, mid-green ones, thin bright streaks. */
const Currents = memo(function Currents({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Shapes paths={DARK_STROKES} fill="#1F7316" />
      <Shapes paths={MID_STROKES} fill="#74D63C" opacity={0.9} />
      <Shapes paths={LIGHT_STROKES} fill="#C2FF73" opacity={0.85} />
    </Svg>
  );
});

const Core = memo(function Core({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Shapes paths={CORE_STROKES} fill="#4DB22D" opacity={0.8} />
    </Svg>
  );
});

/** Black hole at the centre: the portal's depth. Soft edge, so the currents seem to sink into it. */
const Depth = memo(function Depth({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="ptDepth" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#000000" stopOpacity={1} />
          <Stop offset="0.38" stopColor="#000000" stopOpacity={0.96} />
          <Stop offset="0.7" stopColor="#000000" stopOpacity={0.45} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill="url(#ptDepth)" />
    </Svg>
  );
});

const Bubbles = memo(function Bubbles({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {BUBBLES.map((b, i) => (
        <Circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill="#F5FFEC" />
      ))}
    </Svg>
  );
});

/**
 * Green liquid portal inside the vault: a wobbly lime rim, currents of
 * green swirling into a black hole, white bubbles drifting round. Each layer
 * turns at its own pace (the currents flow inwards, the centre faster, the
 * bubbles slower, the rim the other way so its edge ripples) and the whole
 * thing breathes. For the moment it pulls you in, `spin` adds a turn on top
 * and `depth` widens the black hole (1: its resting size), so you dive into
 * the dark.
 */
export function Portal({
  size,
  spin,
  depth,
}: {
  size: number;
  spin?: Animated.AnimatedInterpolation<string>;
  depth?: Animated.AnimatedInterpolation<number>;
}) {
  const [v] = useState(() => ({ swirl: new Animated.Value(0), drift: new Animated.Value(0), breathe: new Animated.Value(0) }));
  const { swirl, drift, breathe } = v;

  useEffect(() => {
    const linear = (value: Animated.Value, duration: number) =>
      Animated.loop(Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    const wave = (toValue: number) =>
      Animated.timing(breathe, { toValue, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true });
    const loops = Animated.parallel([linear(swirl, SWIRL_MS), linear(drift, DRIFT_MS), Animated.loop(Animated.sequence([wave(1), wave(0)]))]);
    loops.start();
    return () => loops.stop();
  }, [swirl, drift, breathe]);

  const turn = (value: Animated.Value, degrees: number) => [
    StyleSheet.absoluteFill,
    { transform: [{ rotate: value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${degrees}deg`] }) }] },
  ];
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        width: size,
        height: size,
        transform: [...(spin ? [{ rotate: spin }] : []), { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
      }}
    >
      <Animated.View style={turn(drift, -360)}>
        <Rim size={size} />
      </Animated.View>
      <Animated.View style={turn(swirl, 360)}>
        <Currents size={size} />
      </Animated.View>
      <Animated.View style={turn(swirl, 720)}>
        <Core size={size} />
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Animated.View style={depth ? { transform: [{ scale: depth }] } : null}>
          <Depth size={size * HOLE} />
        </Animated.View>
      </View>
      <Animated.View style={turn(drift, 360)}>
        <Bubbles size={size} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
