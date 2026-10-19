import {
  Binoculars,
  Coins,
  Drill,
  Gem,
  HandCoins,
  HatGlasses,
  KeyRound,
  Landmark,
  PiggyBank,
  UserRound,
  Vault,
  VenetianMask,
  type LucideIcon,
} from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { colors } from './theme';

/*
 * Profile pictures are icons, never uploaded photos: an empty silhouette by
 * default, or one of these heist-themed outline icons from Lucide
 * (lucide.dev, ISC licence). The id is all the server stores (same list in
 * server/src/app.ts).
 */

export const AVATARS = ['mask', 'spy', 'bank', 'vault', 'gem', 'gold', 'loot', 'piggy', 'key', 'drill', 'lookout'] as const;
export type AvatarId = (typeof AVATARS)[number];

const ICONS: Record<AvatarId | 'default', LucideIcon> = {
  default: UserRound,
  mask: VenetianMask,
  spy: HatGlasses,
  bank: Landmark,
  vault: Vault,
  gem: Gem,
  gold: Coins,
  loot: HandCoins,
  piggy: PiggyBank,
  key: KeyRound,
  drill: Drill,
  lookout: Binoculars,
};

export const AVATAR_LABELS: Record<AvatarId | 'default', string> = {
  default: 'Silhouette',
  mask: 'Masque',
  spy: 'Espion',
  bank: 'Banque',
  vault: 'Coffre-fort',
  gem: 'Diamant',
  gold: 'Pièces d’or',
  loot: 'Butin',
  piggy: 'Tirelire',
  key: 'Clé',
  drill: 'Perceuse',
  lookout: 'Guetteur',
};

export const isAvatarId = (v: unknown): v is AvatarId => typeof v === 'string' && (AVATARS as readonly string[]).includes(v);

/**
 * Round badge with a bevelled metal ring (light on top, dark below, as on
 * the keypad keys) and the outline icon inside.
 */
export function Avatar({ id, size = 40, selected }: { id: AvatarId | null | undefined; size?: number; selected?: boolean }) {
  const known = isAvatarId(id) ? id : null;
  const Icon = ICONS[known ?? 'default'];
  return (
    <View
      accessibilityLabel={`Avatar : ${AVATAR_LABELS[known ?? 'default']}`}
      style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }, selected && styles.selected]}
    >
      <Icon size={size * 0.55} color={selected ? colors.text : colors.accentFg} strokeWidth={1.75} />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1D2023',
    borderWidth: 1.5,
    borderTopColor: '#4A5056',
    borderLeftColor: '#4A5056',
    borderBottomColor: '#0A0B0C',
    borderRightColor: '#0A0B0C',
  },
  selected: {
    backgroundColor: colors.accent,
    borderTopColor: '#2E8A48',
    borderLeftColor: '#2E8A48',
    borderBottomColor: '#2E8A48',
    borderRightColor: '#2E8A48',
  },
});
