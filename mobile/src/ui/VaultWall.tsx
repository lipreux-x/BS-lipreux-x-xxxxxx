import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

const COLS = 2;
const ROWS = 4;
const GRAIN = 5;
const RIVET_INSET = 12;

/**
 * Full-screen vault wall behind the door: brushed steel, riveted plates, and
 * a darker vignette towards the edges. Static: drawn once, with plain views.
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
      ]) {
        rivets.push({ x: x0 + x, y: y0 + y });
      }
    }
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.wall]} pointerEvents="none">
      {/* Brushed grain: faint alternating light/dark lines. */}
      {Array.from({ length: Math.ceil(height / GRAIN) }, (_, i) => (
        <View key={`g${i}`} style={[styles.grain, { top: i * GRAIN }, i % 2 ? styles.grainDark : styles.grainLight]} />
      ))}

      {/* Plate seams: a dark groove with a lit lower lip. */}
      {Array.from({ length: COLS - 1 }, (_, i) => (
        <View key={`v${i}`} style={[styles.seamV, { left: (i + 1) * plateW - 1.5 }]} />
      ))}
      {Array.from({ length: ROWS - 1 }, (_, i) => (
        <View key={`h${i}`} style={[styles.seamH, { top: (i + 1) * plateH - 1.5 }]} />
      ))}

      {rivets.map(({ x, y }, i) => (
        <View key={`r${i}`} style={[styles.rivet, { left: x - 4, top: y - 4 }]}>
          <View style={styles.rivetShine} />
        </View>
      ))}

      {/* Vignette: stacked translucent borders darken the edges. */}
      {[0.35, 0.25, 0.15].map((o, i) => (
        <View
          key={`n${i}`}
          style={[StyleSheet.absoluteFill, { borderWidth: (i + 1) * 28, borderColor: `rgba(0,0,0,${o})` }]}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  wall: { backgroundColor: '#15181A', overflow: 'hidden' },
  grain: { position: 'absolute', left: 0, right: 0, height: 1 },
  grainLight: { backgroundColor: 'rgba(255,255,255,0.025)' },
  grainDark: { backgroundColor: 'rgba(0,0,0,0.18)' },
  seamV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#07080A',
    borderRightWidth: 1,
    borderRightColor: '#2C3236',
  },
  seamH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#07080A',
    borderBottomWidth: 1,
    borderBottomColor: '#2C3236',
  },
  rivet: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3A3F44',
    borderWidth: 1,
    borderTopColor: '#5A6168',
    borderLeftColor: '#5A6168',
    borderBottomColor: '#050505',
    borderRightColor: '#050505',
  },
  rivetShine: {
    position: 'absolute',
    top: 1,
    left: 1,
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
