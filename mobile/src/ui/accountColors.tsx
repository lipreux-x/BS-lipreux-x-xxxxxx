import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { bevel, blade, colors, neon, space, steel } from './theme';

/*
 * Each account picks its color (Settings, beside the avatar): in the chats,
 * its name is lit in it and its messages are tinted with it (a dark shade, so
 * the white text stays readable), for every member. The id is all the server stores (same list in server/src/app.ts). No red: it
 * stays for errors and what is shut. Null: the default, the terminal's green
 * for mine and the sky blue for the others'.
 */

export const ACCOUNT_COLORS = ['sky', 'phosphor', 'cyan', 'violet', 'rose', 'amber', 'orange', 'gold'] as const;
export type AccountColorId = (typeof ACCOUNT_COLORS)[number];

const HEX: Record<AccountColorId, string> = {
  sky: blade.sky,
  phosphor: blade.neon,
  cyan: '#2EF2D0',
  violet: '#B48CFF',
  rose: '#FF6FB5',
  amber: '#FFB020',
  orange: '#FF7A3D',
  gold: '#FFE14D',
};

export const ACCOUNT_COLOR_LABELS: Record<AccountColorId | 'default', string> = {
  default: 'Par défaut',
  sky: 'Ciel',
  phosphor: 'Phosphore',
  cyan: 'Turquoise',
  violet: 'Violet',
  rose: 'Rose',
  amber: 'Ambre',
  orange: 'Orange',
  gold: 'Or',
};

export function isAccountColorId(v: unknown): v is AccountColorId {
  return typeof v === 'string' && (ACCOUNT_COLORS as readonly string[]).includes(v);
}

/** The light of an account color; null (none chosen, or unknown to this version): the default of its side. */
export function accountColor(id: unknown): string | null {
  return isAccountColorId(id) ? HEX[id] : null;
}

/** An account color's shades for a message: its plate face and bevel, its terminal wash. */
export interface AccountTones {
  lit: string;
  face: string;
  edgeLight: string;
  edgeDark: string;
  wash: string;
}

/** The color darkened towards black (k = how much of it is left). */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * k)}, ${Math.round(((n >> 8) & 255) * k)}, ${Math.round((n & 255) * k)})`;
}

export function accountTones(id: unknown): AccountTones | null {
  if (!isAccountColorId(id)) return null;
  const hex = HEX[id];
  const n = parseInt(hex.slice(1), 16);
  return {
    lit: hex,
    face: shade(hex, 0.26),
    edgeLight: shade(hex, 0.5),
    edgeDark: shade(hex, 0.1),
    wash: `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.2)`,
  };
}

const CHOICES: (AccountColorId | null)[] = [null, ...ACCOUNT_COLORS];

/**
 * The colors as small steel keys, 3 per row, each a lamp over its name:
 * "Par défaut" shows its two lights, green and sky blue. The chosen key is
 * edged in white, its lamp glowing.
 */
export function AccountColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: AccountColorId | null;
  onChange(id: AccountColorId | null): void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.grid}>
      {CHOICES.map((id) => {
        const selected = id === value;
        const label = ACCOUNT_COLOR_LABELS[id ?? 'default'];
        return (
          <Pressable
            key={id ?? 'default'}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`Couleur ${label}`}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync();
              onChange(id);
            }}
            style={({ pressed }) => [styles.cell, selected && styles.cellOn, pressed && styles.pressed, disabled && styles.disabled]}
          >
            {id ? (
              <View style={[styles.lamp, { backgroundColor: HEX[id] }, selected && neon.box(HEX[id], 8)]} />
            ) : (
              <View style={styles.pair}>
                <View style={[styles.half, { backgroundColor: blade.neon }]} />
                <View style={[styles.half, { backgroundColor: blade.sky }]} />
              </View>
            )}
            <Text style={[styles.label, selected && styles.labelOn]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const LAMP = 16;

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: {
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 58,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: steel.key,
    borderWidth: 1,
    ...bevel(steel.edgeLight, steel.edgeDark),
  },
  cellOn: { backgroundColor: steel.plate, ...bevel(colors.text, colors.text) },
  pressed: { backgroundColor: steel.keyPressed, transform: [{ translateY: 1 }] },
  disabled: { opacity: 0.5 },
  lamp: { width: LAMP, height: LAMP, borderRadius: LAMP / 2 },
  pair: { width: LAMP, height: LAMP, borderRadius: LAMP / 2, overflow: 'hidden', flexDirection: 'row' },
  half: { flex: 1 },
  label: { color: colors.textDim, fontSize: 12 },
  labelOn: { color: colors.text },
});
