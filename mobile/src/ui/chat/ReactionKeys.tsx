import * as Haptics from 'expo-haptics';
import { Coins, Crown, Flame, LockKeyhole, ThumbsUp, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { REACTIONS, type ReactionId } from '@/crypto';
import { colors, mono } from '../theme';
import { moveKey, REACTION_COLORS, REACTION_LABELS, withAlpha, type ReactionCount } from './reactions';

/*
 * The five reactions, drawn in the app's own style (the safe's control
 * panel): outline icons on bevelled metal keys, each in its own colour,
 * never emoji. The one I gave is lit (tinted and glowing in its colour).
 * Everything pops into place with a spring.
 */

const ICONS: Record<ReactionId, LucideIcon> = { like: ThumbsUp, crown: Crown, money: Coins, fire: Flame, secret: LockKeyhole };

export function ReactionIcon({ id, size }: { id: ReactionId; size: number }) {
  const Icon = ICONS[id];
  return <Icon size={size} color={REACTION_COLORS[id]} strokeWidth={2.25} />;
}

/** Springs in on mount, and pops again each time `beat` changes (a count, a choice). */
function Pop({ beat, children, style }: { beat: unknown; children: React.ReactNode; style?: object }) {
  const [scale] = useState(() => new Animated.Value(0.5));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 14, speed: 24 }).start();
      return;
    }
    scale.setValue(1.3);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 12, speed: 20 }).start();
  }, [beat, scale]);
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/** The lit look of a key or plate: tinted and glowing in the reaction's colour. */
const lit = (id: ReactionId) => {
  const c = REACTION_COLORS[id];
  return { backgroundColor: withAlpha(c, 0.18), borderTopColor: withAlpha(c, 0.7), borderLeftColor: withAlpha(c, 0.7), boxShadow: `0 0 8px ${withAlpha(c, 0.55)}` };
};

/** Under a bubble: what it got, as small plates with the count; mine lit. A tap gives (or takes back) the same reaction. */
export function ReactionChips({ counts, onPress }: { counts: ReactionCount[]; onPress?(id: ReactionId): void }) {
  return (
    <View style={styles.chips}>
      {counts.map((c) => (
        <Pop key={c.reaction} beat={`${c.count}/${c.mine}`}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${REACTION_LABELS[c.reaction]} : ${c.count}${c.mine ? ', dont toi' : ''}`}
            disabled={!onPress}
            onPress={() => onPress?.(c.reaction)}
            style={({ pressed }) => [styles.chip, c.mine && lit(c.reaction), pressed && styles.pressed]}
          >
            <ReactionIcon id={c.reaction} size={13} />
            <Text style={styles.count}>{c.count}</Text>
          </Pressable>
        </Pop>
      ))}
    </View>
  );
}

const GAP = 8;
const KEY_H = 46;
/** How long a key is held before it lifts to be moved. */
const LIFT_MS = 250;

/**
 * In the message's panel: the five keys in the order chosen on this phone;
 * the one already given is lit, and a tap on it takes it back. A long press
 * on a key lifts it: dragged left or right, it takes a new place (the
 * others slide aside), kept for next time (`onReorder`).
 */
export function ReactionKeys({ order, current, onPick, onReorder }: { order: ReactionId[]; current: ReactionId | null; onPick(id: ReactionId): void; onReorder(order: ReactionId[]): void }) {
  const [width, setWidth] = useState(0);
  const slot = width > 0 ? (width - GAP * (order.length - 1)) / order.length : 0;
  const stride = slot + GAP;
  // Where each key sits (by id), sprung to its slot; the lifted one follows the finger.
  const [xs] = useState(() => new Map(order.map((id) => [id, new Animated.Value(0)] as const)));
  const [lift] = useState(() => new Animated.Value(1));
  // The order shown while a key is dragged, then committed.
  const [shown, setShown] = useState(order);
  const [dragging, setDragging] = useState<ReactionId | null>(null);
  // Read by the gesture handlers, created once.
  const latest = useRef({ shown, stride, dragging, current, onPick, onReorder });
  latest.current = { shown, stride, dragging, current, onPick, onReorder };

  useEffect(() => setShown(order), [order]);

  // Every key not under the finger springs to its slot.
  useEffect(() => {
    if (!stride) return;
    shown.forEach((id, i) => {
      if (id === dragging) return;
      Animated.spring(xs.get(id)!, { toValue: i * stride, useNativeDriver: true, bounciness: 6, speed: 20 }).start();
    });
  }, [shown, stride, dragging, xs]);

  function drop() {
    const { shown, onReorder, dragging } = latest.current;
    setDragging(null);
    Animated.spring(lift, { toValue: 1, useNativeDriver: true, bounciness: 8, speed: 20 }).start();
    if (dragging) onReorder(shown);
  }

  function pickUp(id: ReactionId) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDragging(id);
    Animated.spring(lift, { toValue: 1.15, useNativeDriver: true, bounciness: 10, speed: 24 }).start();
  }

  /**
   * One handler per key, owning the whole touch: a short press picks the
   * reaction, a long press lifts the key, and from there the finger drags
   * it along the row (the responder never changes hands, so a drag after a
   * long press is never lost to the panel underneath).
   */
  const [pans] = useState(() => {
    const make = (id: ReactionId) => {
      let from = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let lifted = false;
      let moved = false;
      const clear = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => !lifted,
        onPanResponderGrant: () => {
          lifted = false;
          moved = false;
          from = latest.current.shown.indexOf(id) * latest.current.stride;
          timer = setTimeout(() => {
            timer = null;
            lifted = true;
            pickUp(id);
          }, LIFT_MS);
        },
        onPanResponderMove: (_e, g) => {
          if (!lifted) {
            // A slide before the long press: the panel may scroll, not us.
            if (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8) {
              clear();
              moved = true;
            }
            return;
          }
          const { shown, stride } = latest.current;
          if (!stride) return;
          const x = Math.max(0, Math.min((shown.length - 1) * stride, from + g.dx));
          xs.get(id)!.setValue(x);
          const to = Math.round(x / stride);
          const at = shown.indexOf(id);
          if (to !== at) {
            void Haptics.selectionAsync();
            setShown(moveKey(shown, at, to));
          }
        },
        onPanResponderRelease: () => {
          clear();
          if (lifted) drop();
          else if (!moved) latest.current.onPick(id);
        },
        onPanResponderTerminate: () => {
          clear();
          if (lifted) drop();
        },
      });
    };
    return new Map(REACTIONS.map((id) => [id, make(id)] as const));
  });

  return (
    <View style={[styles.keys, { height: KEY_H }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="radiogroup">
      {width > 0
        ? shown.map((id) => (
            <Animated.View
              key={id}
              {...pans.get(id)!.panHandlers}
              accessibilityRole="radio"
              accessibilityLabel={REACTION_LABELS[id]}
              accessibilityHint="Appui long pour la déplacer"
              accessibilityState={{ selected: current === id }}
              style={[
                styles.keySlot,
                { width: slot, transform: [{ translateX: xs.get(id)! }, { scale: dragging === id ? lift : 1 }] },
                dragging === id && styles.lifted,
              ]}
            >
              <Pop beat={current === id}>
                <View style={[styles.key, current === id && lit(id)]}>
                  <ReactionIcon id={id} size={22} />
                </View>
              </Pop>
            </Animated.View>
          ))
        : null}
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
  keys: { marginBottom: 4 },
  keySlot: { position: 'absolute', top: 0, left: 0, height: KEY_H },
  key: { ...PLATE, height: KEY_H, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lifted: { zIndex: 1, elevation: 4 },
  pressed: { transform: [{ translateY: 1 }], opacity: 0.9 },
});
