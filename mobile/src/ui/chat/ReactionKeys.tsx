import { Coins, Crown, Flame, LockKeyhole, ThumbsUp, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { REACTIONS, type ReactionId } from '@/crypto';
import { colors, mono } from '../theme';
import { REACTION_LABELS, type ReactionCount } from './reactions';

/*
 * The five reactions, drawn in the app's own style (the safe's control
 * panel): outline icons on bevelled metal keys, never emoji. The one I gave
 * is lit green like the keypad's "open" key.
 */

const ICONS: Record<ReactionId, LucideIcon> = { like: ThumbsUp, crown: Crown, money: Coins, fire: Flame, secret: LockKeyhole };

export function ReactionIcon({ id, size, color = colors.text }: { id: ReactionId; size: number; color?: string }) {
  const Icon = ICONS[id];
  return <Icon size={size} color={color} strokeWidth={2} />;
}

/** Under a bubble: what it got, as small plates with the count; mine lit. A tap gives (or takes back) the same reaction. */
export function ReactionChips({ counts, onPress }: { counts: ReactionCount[]; onPress?(id: ReactionId): void }) {
  return (
    <View style={styles.chips}>
      {counts.map((c) => (
        <Pressable
          key={c.reaction}
          accessibilityRole="button"
          accessibilityLabel={`${REACTION_LABELS[c.reaction]} : ${c.count}${c.mine ? ', dont toi' : ''}`}
          disabled={!onPress}
          onPress={() => onPress?.(c.reaction)}
          style={({ pressed }) => [styles.chip, c.mine && styles.lit, pressed && styles.pressed]}
        >
          <ReactionIcon id={c.reaction} size={13} />
          <Text style={styles.count}>{c.count}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** In the message's panel: the five keys; the one already given is lit, and a tap on it takes it back. */
export function ReactionKeys({ current, onPick }: { current: ReactionId | null; onPick(id: ReactionId): void }) {
  return (
    <View style={styles.keys} accessibilityRole="radiogroup">
      {REACTIONS.map((id) => (
        <Pressable
          key={id}
          accessibilityRole="radio"
          accessibilityLabel={REACTION_LABELS[id]}
          accessibilityState={{ selected: current === id }}
          onPress={() => onPick(id)}
          style={({ pressed }) => [styles.key, current === id && styles.lit, pressed && styles.pressed]}
        >
          <ReactionIcon id={id} size={22} />
        </Pressable>
      ))}
    </View>
  );
}

// Bevelled metal, as the keypad keys: lit on the upper-left edges, dark below.
const PLATE = {
  backgroundColor: '#1D2023',
  borderWidth: 1,
  borderTopColor: '#4A5056',
  borderLeftColor: '#4A5056',
  borderBottomColor: '#0A0B0C',
  borderRightColor: '#0A0B0C',
} as const;

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  chip: { ...PLATE, flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: 12 },
  count: { color: colors.text, fontFamily: mono, fontSize: 11 },
  keys: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  key: { ...PLATE, flex: 1, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lit: { backgroundColor: colors.forest, borderTopColor: '#2E8A48', borderLeftColor: '#2E8A48', borderBottomColor: '#124A24', borderRightColor: '#124A24' },
  pressed: { transform: [{ translateY: 1 }], opacity: 0.9 },
});
