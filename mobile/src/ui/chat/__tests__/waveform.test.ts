import { durationLabel, level, squeeze, stretch } from '../waveform';

describe('waveform', () => {
  it('maps microphone levels to 0–100', () => {
    expect(level(0)).toBe(100);
    expect(level(-160)).toBe(0);
    expect(level(-27.5)).toBe(50);
    expect(level(Number.NaN)).toBe(0);
  });

  it('squeezes long recordings to the loudest sample of each slice', () => {
    expect(squeeze([10, 20, 30])).toEqual([10, 20, 30]);
    const bars = squeeze(Array.from({ length: 400 }, (_, i) => i % 100), 40);
    expect(bars).toHaveLength(40);
    expect(bars.every((b) => b >= 9)).toBe(true);
  });

  it('stretches what a message carries to the bubble width', () => {
    expect(stretch([0, 100], 4)).toEqual([0, 0, 100, 100]);
    expect(stretch(undefined, 3)).toEqual([8, 8, 8]);
  });

  it('labels durations', () => {
    expect(durationLabel(7300)).toBe('0:07');
    expect(durationLabel(102_000)).toBe('1:42');
  });
});
