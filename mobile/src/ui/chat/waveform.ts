/*
 * Voice message waveforms, independent of React. While recording, the
 * microphone level (dBFS, -160 to 0) is sampled a few times per second; the
 * message carries it squeezed to a few dozen bars of 0–100.
 */

export const WAVEFORM_BARS = 40;
const FLOOR_DB = -55; // quieter than this reads as silence

/** Microphone level in dBFS to a bar height of 0–100. */
export function level(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.round(Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB)) * 100);
}

/** `bars` bars from the samples (0–100): the loudest sample of each slice. Fewer when there are fewer samples. */
export function squeeze(samples: number[], bars = WAVEFORM_BARS): number[] {
  if (samples.length <= bars) return samples.map((s) => Math.round(s));
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const slice = samples.slice(Math.floor((i * samples.length) / bars), Math.floor(((i + 1) * samples.length) / bars));
    out.push(Math.round(Math.max(...slice)));
  }
  return out;
}

/** `bars` bars to draw from what the message carries (flat line when it has none). */
export function stretch(waveform: number[] | undefined, bars = WAVEFORM_BARS): number[] {
  if (!waveform?.length) return new Array<number>(bars).fill(8);
  return Array.from({ length: bars }, (_, i) => waveform[Math.floor((i * waveform.length) / bars)]!);
}

/** "0:07", "1:42". */
export function durationLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
