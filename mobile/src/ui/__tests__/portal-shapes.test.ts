import { blob, BUBBLES, CORE_STROKES, DARK_STROKES, LIGHT_STROKES, MID_STROKES, stroke } from '../portalShapes';

const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);

describe('portal shapes', () => {
  it('stay inside the 100×100 drawing, with no NaN', () => {
    for (const d of [blob(48.5, 1.6), ...DARK_STROKES, ...MID_STROKES, ...LIGHT_STROKES, ...CORE_STROKES]) {
      expect(d).not.toContain('NaN');
      for (const n of numbers(d)) expect(n >= 0 && n <= 100).toBe(true);
    }
    for (const b of BUBBLES) expect(Math.hypot(b.cx - 50, b.cy - 50) + b.r).toBeLessThanOrEqual(50);
  });

  it('are the same at each launch', () => {
    expect(stroke(1, 40, 5, 0.8, 10)).toBe(stroke(1, 40, 5, 0.8, 10));
  });
});
