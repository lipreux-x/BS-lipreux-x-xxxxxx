/*
 * Shapes of the vault's portal, in a 100×100 viewBox centred on (50, 50).
 * Pure geometry, independent of React: everything is computed once.
 */

const C = 50;
const TAU = 2 * Math.PI;

const point = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;

/** Repeatable pseudo-random numbers in [0, 1), so the portal looks the same at each launch. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Closed wobbly outline around the centre: radius r, bumps of the given
 * amplitude, so the portal's edge looks liquid rather than drawn with a compass.
 */
export function blob(r: number, amplitude: number, phase = 0): string {
  const points: string[] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * TAU;
    const wobble = Math.sin(7 * a + phase) * 0.6 + Math.sin(11 * a + 2 * phase + 1) * 0.3 + Math.sin(17 * a + 0.5) * 0.1;
    points.push(point(r + amplitude * wobble, a));
  }
  return `M${points.join(' L')} Z`;
}

/**
 * A brush stroke of liquid swirling inwards: it starts at angle `a0` and
 * radius r0, curls by `turns` towards r1, thick in the middle and pointed at
 * both ends, with a slight ripple along it. The angle grows with the radius,
 * so turning it clockwise makes it seem to flow towards the centre.
 */
export function stroke(a0: number, r0: number, r1: number, turns: number, width: number, ripple = 1.2): string {
  const outer: string[] = [];
  const inner: string[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const r = r0 + (r1 - r0) * f + ripple * Math.sin(f * 3 * Math.PI + a0);
    const a = a0 + f * turns * TAU;
    const half = (width / 2) * Math.pow(Math.sin(Math.PI * f), 0.7);
    outer.push(point(r + half, a));
    inner.push(point(Math.max(0, r - half), a));
  }
  return `M${outer.join(' L')} L${inner.reverse().join(' L')} Z`;
}

/** `count` strokes evenly around the centre, each a little different so it does not look mechanical. */
function strokes(seed: number, count: number, r0: number, r1: number, turns: number, width: number): string[] {
  const rnd = random(seed);
  return Array.from({ length: count }, (_, i) =>
    stroke(
      (i / count) * TAU + rnd() * 0.6,
      r0 * (0.9 + rnd() * 0.2),
      r1 * (0.85 + rnd() * 0.3),
      turns * (0.85 + rnd() * 0.3),
      width * (0.75 + rnd() * 0.5),
    ),
  );
}

/** Wide dark currents, the body of the swirl. */
export const DARK_STROKES = strokes(7, 5, 42, 6, 0.85, 12);
/** Mid-green currents between them. */
export const MID_STROKES = strokes(21, 5, 41, 9, 0.8, 8);
/** Thin bright streaks on top. */
export const LIGHT_STROKES = strokes(42, 6, 43, 12, 0.75, 3.2);
/** Small fast currents around the centre. */
export const CORE_STROKES = strokes(77, 4, 22, 2, 0.9, 6);

/** White bubbles scattered in a ring near the edge, bigger towards the outside. */
export const BUBBLES = (() => {
  const rnd = random(1234);
  return Array.from({ length: 38 }, () => {
    const r = 27 + rnd() * 19;
    const a = rnd() * TAU;
    return { cx: C + r * Math.cos(a), cy: C + r * Math.sin(a), r: 0.45 + ((r - 27) / 19) * 1.3 * rnd() + 0.35 * rnd() };
  });
})();
