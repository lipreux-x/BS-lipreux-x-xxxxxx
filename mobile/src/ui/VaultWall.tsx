import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

const COLS = 2;
const ROWS = 4;
const GRAIN = 3;
const RIVET_INSET = 12;

/**
 * Full-screen vault wall behind the door: brushed steel plates with grooved
 * seams and rivets, a cool light from above the door, and dark edges.
 * Static: drawn once.
 */
export const VaultWall = memo(function VaultWall({ width, height }: { width: number; height: number }) {
  const plateW = width / COLS;
  const plateH = height / ROWS;
  const rivets: { x: number; y: number }[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const x0 = c * plateW;
      const y0 = r * plateH;
      for (const [x, y] of [
        [RIVET_INSET, RIVET_INSET],
        [plateW - RIVET_INSET, RIVET_INSET],
        [RIVET_INSET, plateH - RIVET_INSET],
        [plateW - RIVET_INSET, plateH - RIVET_INSET],
        [plateW / 2, RIVET_INSET],
        [plateW / 2, plateH - RIVET_INSET],
      ] as const) {
        rivets.push({ x: x0 + x, y: y0 + y });
      }
    }
  }

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="waBase" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1B1F22" />
          <Stop offset="1" stopColor="#101214" />
        </LinearGradient>
        <RadialGradient id="waSpot" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#C9D2DA" stopOpacity="0.16" />
          <Stop offset="0.6" stopColor="#C9D2DA" stopOpacity="0.05" />
          <Stop offset="1" stopColor="#C9D2DA" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="waVignette" cx="0.5" cy="0.48" r="0.75">
          <Stop offset="0.45" stopColor="#000000" stopOpacity="0" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.85" />
        </RadialGradient>
        <RadialGradient id="waRivet" cx="0.35" cy="0.3" r="0.8">
          <Stop offset="0" stopColor="#8D959C" />
          <Stop offset="0.5" stopColor="#3A3F44" />
          <Stop offset="1" stopColor="#0A0B0C" />
        </RadialGradient>
      </Defs>

      <Rect width={width} height={height} fill="url(#waBase)" />
      {/* Brushed grain. */}
      {Array.from({ length: Math.ceil(height / GRAIN) }, (_, i) => (
        <Line
          key={`g${i}`}
          x1="0"
          x2={width}
          y1={i * GRAIN + 0.5}
          y2={i * GRAIN + 0.5}
          stroke={i % 2 ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.16)'}
          strokeWidth="1"
        />
      ))}

      {/* Plate seams: a dark groove with a lit lower/right lip. */}
      {Array.from({ length: COLS - 1 }, (_, i) => {
        const x = (i + 1) * plateW;
        return (
          <G key={`v${i}`}>
            <Rect x={x - 1.5} y="0" width="3" height={height} fill="#07080A" />
            <Line x1={x + 2} x2={x + 2} y1="0" y2={height} stroke="#2C3236" strokeWidth="1" />
          </G>
        );
      })}
      {Array.from({ length: ROWS - 1 }, (_, i) => {
        const y = (i + 1) * plateH;
        return (
          <G key={`h${i}`}>
            <Rect x="0" y={y - 1.5} width={width} height="3" fill="#07080A" />
            <Line x1="0" x2={width} y1={y + 2} y2={y + 2} stroke="#2C3236" strokeWidth="1" />
          </G>
        );
      })}

      {rivets.map(({ x, y }, i) => (
        <G key={`r${i}`}>
          <Circle cx={x + 0.7} cy={y + 1} r="4.2" fill="rgba(0,0,0,0.55)" />
          <Circle cx={x} cy={y} r="4" fill="url(#waRivet)" />
        </G>
      ))}

      {/* Light from a lamp above the door, then the dark edges. */}
      <Ellipse cx={width / 2} cy={height * 0.32} rx={width * 0.9} ry={height * 0.45} fill="url(#waSpot)" />
      <Rect width={width} height={height} fill="url(#waVignette)" />
    </Svg>
  );
});
