import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Label } from './Label';
import { bevel, blade, colors, space, steel } from './theme';

/**
 * The style of a panel of the safe, for views that cannot be a `Panel`
 * (an animated one, a card whose children are laid out by hand): dark
 * surface, its upper-left edge lit, the lower-right one lost in the black.
 */
export const panelStyle = {
  borderRadius: 14,
  backgroundColor: colors.surface,
  borderWidth: 1,
  ...bevel(steel.panelEdge, blade.black),
} as const;

/**
 * A panel of the safe's control board: every card, section and sheet of the
 * app. Optional engraved title (a `Label`, with its icon) and four screws in
 * the corners for the panels that stand alone (a dialog, the keypad).
 */
export function Panel({
  title,
  icon,
  screws,
  style,
  children,
}: {
  title?: string;
  icon?: LucideIcon;
  screws?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View style={[styles.panel, style]}>
      {screws ? <Screws /> : null}
      {title ? (
        <Label icon={icon} lit>
          {title}
        </Label>
      ) : null}
      {children}
    </View>
  );
}

/** Four slotted screws, one in each corner of the panel they sit in. */
export function Screws() {
  return (
    <>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} style={[styles.screw, styles[c]]} pointerEvents="none">
          <View style={styles.slot} />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  panel: { ...panelStyle, padding: space.md, gap: space.sm },
  screw: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: steel.screw,
    borderWidth: 1,
    borderColor: steel.edgeDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot: { width: 4, height: 1.5, backgroundColor: steel.edgeDark, transform: [{ rotate: '45deg' }] },
  tl: { top: 7, left: 7 },
  tr: { top: 7, right: 7 },
  bl: { bottom: 7, left: 7 },
  br: { bottom: 7, right: 7 },
});
