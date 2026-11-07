import * as Haptics from 'expo-haptics';
import { Check, ChevronDown, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Keyboard, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactionId } from '@/crypto';
import { type Session } from '@/services/groups';
import type { ReactionCount } from '../chat/reactions';
import { useKeyboardUp } from '../KeyboardGlide';
import { Led } from '../Led';
import { Logo } from '../Logo';
import { colors, fonts, hotKey, mono, steel } from '../theme';
import { fitStory, isNew, openingIndex, railLabel, storyTap, timeLeftLabel, type StoryMessage } from './stories';
import { Shutter, STEEL, StoryPage } from './StoryPage';

/** Height of the shutter's bottom rail: the only part of the band that stays in the chat's flow. */
export const STORIES_RAIL_H = 48;
/** How far a slow pull must go to open the shutter. */
const OPEN_PULL = 72;
/** Height of the shutter with no story on it. */
const EMPTY_H = 220;
const SPRING = { useNativeDriver: true, bounciness: 2, speed: 16 } as const;
/** How long the rail says "PUBLIÉE" after a story of mine went out. */
const PUBLISHED_MS = 4000;

/**
 * The stories of the last 24 h, as a shutter that comes down over the
 * messages. Folded, only its bottom rail shows at the top of the chat: an
 * LED (lit when there are new ones), the count and a "+" key. Pulled down
 * (or tapped), the photo itself comes down with the rail and is the whole
 * shutter, down to the composer: the photo whole and as large as it fits,
 * centred, and behind it the same photo blurred and stretched to fill the
 * rest (like a story). The steel grille over it fades only as the
 * shutter goes further down, gone once it is all the way: a band pulled
 * halfway shows the grille, not the photo. A tap on the right half goes to the next one, on the
 * left half to the previous one, a swipe does the same, and a tap past the
 * last one folds the shutter back. It opens on the first photo not watched
 * yet (oldest first); the photo shown counts as watched. A long press on
 * the photo shows it full screen, where it can be saved. Each photo carries
 * the five reaction keys of the chat in its caption, and typing while it
 * is down answers it (the shutter folds, the reply strip quotes it). The steel grille of
 * a safe's vent shows only with no story at all, where the logo and "Story"
 * sit in the middle (a tap adds one). Pushed back up, it folds.
 *
 * Lies over the messages (absolute, not over the composer), which must leave
 * `STORIES_RAIL_H` free at their top for the rail.
 */
export function StoriesBand({
  session,
  groupId,
  stories,
  seen,
  open,
  sending,
  failed,
  now,
  onOpenChange,
  onAdd,
  onSeen,
  onView,
  reactions,
  order,
  onReact,
  focus,
  onReply,
  onDelete,
  onShowReactions,
}: {
  session: Session;
  groupId: string;
  /** Alive stories, in the band's order (bandStories). */
  stories: StoryMessage[];
  seen: ReadonlySet<string>;
  open: boolean;
  /** One of my stories is being encrypted and uploaded. */
  sending: boolean;
  /** One of my stories was refused by the server. */
  failed: boolean;
  now: Date;
  onOpenChange(open: boolean): void;
  /** The "+" key, or the empty band: add a photo (and manage what failed). */
  onAdd(): void;
  onSeen(storyId: string): void;
  /** Long press on a photo already decrypted: full screen. */
  onView(jpeg: Uint8Array): void;
  /** Per story id, what it got (the chat's tally). */
  reactions: ReadonlyMap<string, ReactionCount[]>;
  /** The reaction keys' order on this phone. */
  order: ReactionId[];
  onReact(storyId: string, id: ReactionId): void;
  /** The story to open on (its quote was tapped), instead of the first one not watched. */
  focus: string | null;
  /** The keyboard came up over this story: the message being typed answers it. */
  onReply(storyId: string): void;
  /** The delete key on one of my stories. */
  onDelete(storyId: string): void;
  /** Long press on a story's reaction keys: who gave which. */
  onShowReactions(storyId: string): void;
}) {
  // The messages area the band lies over; the shutter comes down at most to its bottom.
  // Taken with the keyboard down only: the keyboard goes away as the shutter
  // opens, and the area then grows back in a glide. Following each of its
  // frames re-rendered the photos and restarted the spring frame after frame
  // (the shutter crawled down, then the photo popped in at the end).
  const [area, setArea] = useState({ width: 0, height: 0 });
  const measured = useRef(area);
  const keyboardUp = useKeyboardUp();
  const takeArea = useCallback(() => {
    const m = measured.current;
    setArea((a) => (a.width === m.width && a.height === m.height ? a : m));
  }, []);
  useEffect(() => {
    if (!keyboardUp) takeArea();
  }, [keyboardUp, takeArea]);
  const maxH = Math.max(0, area.height - STORIES_RAIL_H);
  // How far the shutter is down (0: folded). Drives a translation only, never
  // a layout prop: animated natively, and a re-render of the band cannot
  // leave the shutter half-applied (height at one value, translation at another).
  const [height] = useState(() => new Animated.Value(0));
  const list = useRef<FlatList<StoryMessage>>(null);
  // The photo on screen (clamped: a story may have expired under it).
  const [current, setCurrent] = useState(0);
  const at = Math.min(current, Math.max(0, stories.length - 1));
  // How far the shutter comes down: the whole area with stories, a plate without.
  const openH = stories.length ? maxH : Math.min(EMPTY_H, maxH);
  // Nodes derived from `height`, kept across renders: a node created anew on a
  // re-render starts from the JS-side value, stale while the native driver
  // animates, and the shutter would jump for a frame.
  const slide = useMemo(() => Animated.subtract(height, maxH), [height, maxH]);
  const chevron = useMemo(() => height.interpolate({ inputRange: [0, Math.max(1, openH)], outputRange: ['0deg', '180deg'] }), [height, openH]);
  // What comes down first is the steel grille: a second grille lies over the
  // photo and fades as the shutter goes further, gone once it is all the way
  // down. A glance at a half-pulled band shows nothing to someone looking over the shoulder.
  const veil = useMemo(
    () => height.interpolate({ inputRange: [0, Math.max(1, openH) * 0.55, Math.max(1, openH)], outputRange: [1, 0.82, 0], extrapolate: 'clamp' }),
    [height, openH],
  );
  // All the way down and at rest: the veil is not there at all. The photo
  // itself is never faded: with the native driver, a re-render during the
  // spring commits the opacity JS knew then (stale), and the native side does
  // not always put the right one back once it stops, even swapped for a plain
  // opacity of 1 (seen on iPhone): the photo stayed behind the grille with
  // the shutter open. A view taken out of the tree cannot stay half-applied.
  // Where the last spring came to rest (null: a drag moved it since).
  const [restAt, setRestAt] = useState<number | null>(null);
  const atRest = open && openH > 0 && restAt === openH;
  // The same, for the gesture handler (folded at first).
  const rest = useRef<number | null>(0);
  // A pull has begun on the folded shutter: the photo it opens on is lined up
  // and decrypted from then, ready when the finger lets go.
  const [pulling, setPulling] = useState(false);
  const springTo = useCallback(
    (to: number) => {
      Animated.spring(height, { toValue: to, ...SPRING }).start(({ finished }) => {
        if (!finished) return;
        rest.current = to;
        setRestAt(to);
        if (to === 0) setPulling(false);
      });
    },
    [height],
  );
  const prime = useCallback(() => {
    if (!stories.length) return;
    list.current?.scrollToIndex({ index: openingIndex(stories, seen), animated: false });
    setPulling(true);
  }, [stories, seen]);
  const fresh = stories.filter((s) => isNew(s, seen)).length;
  const mine = stories.filter((s) => s.mine).length;

  // A story of mine just went out (the send ended without a refusal): the
  // rail says so for a moment, the "+" key shows a check, the phone taps
  // once. Then the rail names it ("LA TIENNE") as long as it is up.
  const [published, setPublished] = useState(false);
  const wasSending = useRef(sending);
  useEffect(() => {
    const was = wasSending.current;
    wasSending.current = sending;
    if (was && !sending && !failed) {
      setPublished(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [sending, failed]);
  useEffect(() => {
    if (!published) return;
    const t = setTimeout(() => setPublished(false), PUBLISHED_MS);
    return () => clearTimeout(t);
  }, [published]);

  // The gesture handler outlives renders: it reads the latest values from refs.
  const latest = useRef({ open, openH, onOpenChange, prime });
  useEffect(() => {
    latest.current = { open, openH, onOpenChange, prime };
  }, [open, openH, onOpenChange, prime]);

  const settle = useCallback(
    (target: boolean) => {
      springTo(target ? latest.current.openH : 0);
      if (target !== latest.current.open) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // Known at once, before the parent renders: a gesture callback that
        // fires meanwhile (a termination on release) must not send the
        // shutter back where it came from.
        latest.current.open = target;
        latest.current.onOpenChange(target);
      }
    },
    [springTo],
  );

  // The keyboard comes up over an open shutter (a tap on the composer): back
  // to the chat (sized for the area at rest, it would run under the composer),
  // and what is typed answers the story that was on screen.
  const onScreen = useRef<{ id?: string; onReply(id: string): void }>({ onReply });
  useEffect(() => {
    onScreen.current = { id: stories[at]?.id, onReply };
  }, [stories, at, onReply]);
  useEffect(() => {
    if (!keyboardUp || !latest.current.open) return;
    const { id, onReply: reply } = onScreen.current;
    if (id) reply(id);
    settle(false);
  }, [keyboardUp, settle]);

  // Opened or closed from outside (or from a tap), or the area resized: the shutter follows.
  useEffect(() => {
    springTo(open ? openH : 0);
  }, [open, openH, springTo]);

  // Created once; the refs are only read while a drag runs, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => {
    // Where the shutter was when the finger took it. The native value only
    // comes back asynchronously: a move handled before it did used the last
    // drag's start, and the shutter flashed wide open (or shut) for a frame.
    // At rest it is known at once; taken mid-spring, moves wait for it.
    let from: number | null = 0;
    const clamp = (v: number) => Math.min(latest.current.openH, Math.max(0, v));
    return PanResponder.create({
      // Clearly vertical drags only, anywhere on the shutter: taps and the
      // left-right swipe of the photos still reach them.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        if (!latest.current.open) {
          // Pulled down over the keyboard: it goes now, the room it leaves opens under the finger.
          Keyboard.dismiss();
          latest.current.prime();
        }
        from = rest.current;
        rest.current = null;
        setRestAt(null);
        height.stopAnimation((v) => {
          from = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        if (from !== null) height.setValue(clamp(from + g.dy));
      },
      // A flick decides; otherwise a short pull is enough to open (it never
      // snaps back like a pull-to-refresh), and closing takes pushing it
      // nearly all the way up.
      onPanResponderRelease: (_e, g) => {
        if (from === null) return settle(latest.current.open);
        settle(Math.abs(g.vy) > 0.3 ? g.vy > 0 : clamp(from + g.dy) > Math.min(latest.current.openH / 2, OPEN_PULL));
      },
      onPanResponderTerminate: () => settle(latest.current.open),
    });
  });

  /** The photo now on screen: watched. */
  const show = useCallback(
    (index: number) => {
      const story = stories[index];
      if (!story) return;
      setCurrent(index);
      onSeen(story.id);
    },
    [stories, onSeen],
  );

  // On opening: straight to the story asked for, or the first photo not watched yet.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && stories.length) {
      const asked = focus ? stories.findIndex((s) => s.id === focus) : -1;
      const index = asked >= 0 ? asked : openingIndex(stories, seen);
      list.current?.scrollToIndex({ index, animated: false });
      show(index);
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the band opens
  }, [open]);

  /** A tap on the left or right half of the photo. */
  const tap = useCallback(
    (side: 'left' | 'right') => {
      const to = storyTap(side, at, stories.length);
      if (to === 'close') settle(false);
      else if (to !== null) {
        list.current?.scrollToIndex({ index: to, animated: true });
        show(to);
      }
    },
    [at, stories.length, settle, show],
  );

  const add = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onAdd();
  };

  return (
    <View
      style={styles.area}
      pointerEvents="box-none"
      onLayout={(e) => {
        measured.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
        // Never measured yet (the chat opened with the keyboard up): this one, for now.
        if (!keyboardUp || area.height === 0) takeArea();
      }}
    >
      {/* The whole shutter (stage + rail) slides down from above the area, which clips it:
          folded, only the rail shows; the photo's bottom edge rides on the rail. */}
      <Animated.View {...pan.panHandlers} style={[styles.sheet, { transform: [{ translateY: slide }] }]}>
        <View style={[styles.stage, { height: maxH }]}>
          <Shutter />
          {stories.length && area.width > 0 && maxH > 0 ? (
            <View style={{ height: maxH }}>
              <FlatList
              ref={list}
              horizontal
              pagingEnabled
              data={stories}
              keyExtractor={(s) => s.id}
              getItemLayout={(_d, i) => ({
                length: area.width,
                offset: i * area.width,
                index: i,
              })}
              showsHorizontalScrollIndicator={false}
              initialNumToRender={2}
              windowSize={3}
              extraData={reactions}
              onMomentumScrollEnd={(e) => show(Math.round(e.nativeEvent.contentOffset.x / area.width))}
              renderItem={({ item }) => (
                <StoryPage
                  session={session}
                  groupId={groupId}
                  story={item}
                  width={area.width}
                  height={maxH}
                  box={fitStory(item.story, area.width, maxH)}
                  load={open || pulling}
                  now={now}
                  onTap={tap}
                  onView={onView}
                  reactions={reactions.get(item.id)}
                  order={order}
                  onReact={onReact}
                  onDelete={onDelete}
                  onShowReactions={onShowReactions}
                />
              )}
              />
              {atRest ? null : (
                <Animated.View style={[styles.veil, { opacity: veil }]} pointerEvents="none">
                  <Shutter />
                </Animated.View>
              )}
            </View>
          ) : (
            // At the bottom of the stage, like the photos: that is the part that comes down.
            <View style={{ height: openH, justifyContent: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aucune story. Ajouter une story"
                onPress={add}
                style={({ pressed }) => [styles.empty, pressed && styles.pressed]}
              >
                <Logo width={72} />
                <Text style={styles.emptyTitle}>Story</Text>
                <Text style={styles.emptyHint}>{failed ? 'Échec de l’envoi' : sending ? 'Envoi…' : 'Touche pour ajouter une photo'}</Text>
              </Pressable>
            </View>
          )}
        </View>
        <View style={styles.edge}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={open ? 'Replier les stories' : 'Déplier les stories'}
            accessibilityState={{ expanded: open }}
            onPress={() => settle(!open)}
            style={styles.edgeMain}
          >
            <Led state={failed ? 'error' : sending ? 'busy' : published || fresh ? 'ok' : 'off'} size={6} />
            <Text style={styles.label}>{railLabel({
                failed,
                sending,
                published,
                open,
                index: at,
                count: stories.length,
                fresh,
                mine,
                left: stories[at] ? timeLeftLabel(stories[at], now) : undefined,
              })}</Text>
            <Animated.View
              style={{
                transform: [{ rotate: chevron }],
              }}
            >
              <ChevronDown size={16} color={colors.textDim} />
            </Animated.View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajouter une story"
            hitSlop={8}
            onPress={add}
            style={({ pressed }) => [styles.plus, pressed && styles.plusPressed]}
          >
            {sending ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : published ? (
              <Check size={14} color={colors.text} strokeWidth={3} />
            ) : (
              <Plus size={14} color={colors.text} strokeWidth={3} />
            )}
          </Pressable>
          <View style={styles.grip} pointerEvents="none" />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The messages area: clips the shutter sliding in from above it.
  area: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  // The shutter and its rail, over the messages, slid up out of the area when folded.
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Fixed height (the whole area): the photo never squeezes. What shows sits at the bottom, on the rail.
  stage: {
    backgroundColor: STEEL,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  // The grille over the photos while the shutter moves (opaque on its own, like the stage).
  veil: { ...StyleSheet.absoluteFill, backgroundColor: STEEL },
  // Logo and "Story" on a dark plate screwed onto the shutter, so they read over the slots.
  empty: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 20,
    letterSpacing: 0.5,
  },
  emptyHint: { color: colors.textDim, fontSize: 12 },
  // The shutter's bottom rail: a thicker steel bar, lit along its top.
  edge: {
    height: STORIES_RAIL_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 12,
    paddingBottom: 4,
    backgroundColor: steel.key,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  edgeMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: {
    flex: 1,
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.textDim,
  },
  // The rail's handle, centred: a dark recess lit on its lower lip.
  grip: {
    position: 'absolute',
    bottom: 3,
    left: '50%',
    width: 44,
    height: 6,
    marginLeft: -22,
    borderRadius: 3,
    backgroundColor: '#0E1011',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.14)',
  },
  plus: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusPressed: { backgroundColor: hotKey.facePressed },
  pressed: { transform: [{ scale: 0.97 }] },
});
