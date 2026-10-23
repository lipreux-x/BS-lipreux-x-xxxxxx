import * as Haptics from 'expo-haptics';
import { ChevronDown, Plus } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { b64 } from '@/crypto';
import { ApiError } from '@/services/api';
import { loadAttachment, type Session } from '@/services/groups';
import { imageCache, jpegUri, previewUri } from '@/services/images';
import { safeToDisplay } from '@/services/jpeg';
import { Avatar, isAvatarId } from '../avatars';
import { Led } from '../Led';
import { Logo } from '../Logo';
import { colors, fonts, hotKey, mono, steel } from '../theme';
import { agoLabel } from '../chat/timeline';
import { fitStory, isNew, openingIndex, storyExpiry, storyTap, type StoryMessage } from './stories';

/** Height of the shutter's bottom rail: the only part of the band that stays in the chat's flow. */
export const STORIES_RAIL_H = 48;
/** How far a slow pull must go to open the shutter. */
const OPEN_PULL = 72;
/** Height of the shutter with no story on it. */
const EMPTY_H = 220;
/** The avatar on a photo, the size of the chat's. */
const AVATAR = 34;
/** The shutter behind the photos: height of a slat, width of a tile, length of a vent slot. */
const SLAT = 12;
const SLAT_TILE = 36;
const SLOT_W = 14;
const SPRING = { useNativeDriver: true, bounciness: 2, speed: 16 } as const;

type Loaded = { kind: 'loading' } | { kind: 'ready'; jpeg: Uint8Array } | { kind: 'error'; message: string };

/** The story's photo, downloaded and decrypted in memory (or from this session's cache), once `enabled`. */
function useStoryImage(session: Session, groupId: string, story: StoryMessage, enabled: boolean): Loaded {
  const { attachmentId } = story.story;
  // The outcome is kept with the id it is for: another story shows as loading until its own arrives.
  const [done, setDone] = useState<{ id: string; loaded: Loaded } | null>(null);
  useEffect(() => {
    if (!enabled || imageCache.get(attachmentId)) return;
    let live = true;
    loadAttachment(session, groupId, story.story)
      .then((jpeg) => {
        if (!safeToDisplay(jpeg)) {
          if (live)
            setDone({
              id: attachmentId,
              loaded: { kind: 'error', message: 'Photo refusée' },
            });
          return;
        }
        imageCache.set(attachmentId, jpeg);
        if (live) setDone({ id: attachmentId, loaded: { kind: 'ready', jpeg } });
      })
      .catch((e: unknown) => {
        if (!live) return;
        const gone = e instanceof ApiError && e.status === 404;
        setDone({
          id: attachmentId,
          loaded: {
            kind: 'error',
            message: gone ? 'Story expirée' : 'Indisponible',
          },
        });
      });
    return () => {
      live = false;
    };
  }, [session, groupId, story, attachmentId, enabled]);
  const cached = imageCache.get(attachmentId);
  if (cached) return { kind: 'ready', jpeg: cached };
  return done?.id === attachmentId ? done.loaded : { kind: 'loading' };
}

/**
 * The stories of the last 24 h, as a shutter that comes down over the
 * messages. Folded, only its bottom rail shows at the top of the chat: an
 * LED (lit when there are new ones), the count and a "+" key. Pulled down
 * (or tapped), the photo itself comes down with the rail and is the whole
 * shutter, down to the composer: the photo whole and as large as it fits,
 * centred, and behind it the same photo blurred and stretched to fill the
 * rest (like a story). A tap on the right half goes to the next one, on the
 * left half to the previous one, a swipe does the same, and a tap past the
 * last one folds the shutter back. It opens on the first photo not watched
 * yet (oldest first); the photo shown counts as watched. A long press on
 * the photo shows it full screen, where it can be saved. The steel grille of
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
}) {
  // The messages area the band lies over; the shutter comes down at most to its bottom.
  const [area, setArea] = useState({ width: 0, height: 0 });
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
  const fresh = stories.filter((s) => isNew(s, seen)).length;

  // The gesture handler outlives renders: it reads the latest values from refs.
  const latest = useRef({ open, openH, onOpenChange });
  useEffect(() => {
    latest.current = { open, openH, onOpenChange };
  }, [open, openH, onOpenChange]);

  const settle = useCallback(
    (target: boolean) => {
      Animated.spring(height, {
        toValue: target ? latest.current.openH : 0,
        ...SPRING,
      }).start();
      if (target !== latest.current.open) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // Known at once, before the parent renders: a gesture callback that
        // fires meanwhile (a termination on release) must not send the
        // shutter back where it came from.
        latest.current.open = target;
        latest.current.onOpenChange(target);
      }
    },
    [height],
  );

  // Opened or closed from outside (or from a tap), or the area resized: the shutter follows.
  useEffect(() => {
    Animated.spring(height, { toValue: open ? openH : 0, ...SPRING }).start();
  }, [open, openH, height]);

  // Created once; the refs are only read while a drag runs, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => {
    let from = 0;
    const clamp = (v: number) => Math.min(latest.current.openH, Math.max(0, v));
    return PanResponder.create({
      // Clearly vertical drags only, anywhere on the shutter: taps and the
      // left-right swipe of the photos still reach them.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        height.stopAnimation((v) => {
          from = v;
        });
      },
      onPanResponderMove: (_e, g) => height.setValue(clamp(from + g.dy)),
      // A flick decides; otherwise a short pull is enough to open (it never
      // snaps back like a pull-to-refresh), and closing takes pushing it
      // nearly all the way up.
      onPanResponderRelease: (_e, g) => {
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

  // On opening: straight to the first photo not watched yet.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && stories.length) {
      const index = openingIndex(stories, seen);
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
      onLayout={(e) =>
        setArea({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })
      }
    >
      {/* The whole shutter (stage + rail) slides down from above the area, which clips it:
          folded, only the rail shows; the photo's bottom edge rides on the rail. */}
      <Animated.View {...pan.panHandlers} style={[styles.sheet, { transform: [{ translateY: slide }] }]}>
        <View style={[styles.stage, { height: maxH }]}>
          <Shutter />
          {stories.length && area.width > 0 && maxH > 0 ? (
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
              onMomentumScrollEnd={(e) => show(Math.round(e.nativeEvent.contentOffset.x / area.width))}
              renderItem={({ item }) => (
                <StoryPage
                  session={session}
                  groupId={groupId}
                  story={item}
                  width={area.width}
                  height={maxH}
                  box={fitStory(item.story, area.width, maxH)}
                  load={open}
                  now={now}
                  onTap={tap}
                  onView={onView}
                />
              )}
            />
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
            <Led state={failed ? 'error' : fresh ? 'ok' : 'off'} size={6} />
            <Text style={styles.label}>
              STORIES · 24 H
              {failed
                ? ' · ÉCHEC'
                : sending
                  ? ' · ENVOI…'
                  : open && stories.length
                    ? ` · ${at + 1} / ${stories.length}`
                    : fresh
                      ? ` · ${fresh} NOUVELLE${fresh > 1 ? 'S' : ''}`
                      : stories.length
                        ? ` · ${stories.length}`
                        : ''}
            </Text>
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
            {sending ? <ActivityIndicator color={colors.text} size="small" /> : <Plus size={14} color={colors.text} strokeWidth={3} />}
          </Pressable>
          <View style={styles.grip} pointerEvents="none" />
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * The metal shutter behind the photos, as the vent grille of a safe: steel
 * slats, each lit on its upper edge and closed by a dark groove, pierced
 * with vent slots staggered from one slat to the next.
 */
const Shutter = memo(function Shutter() {
  // Two slats per tile: the second one's slot sits halfway along.
  const slat = (y: number, slotX: number) => (
    <>
      <Rect x={0} y={y} width={SLAT_TILE} height={SLAT} fill={STEEL} />
      <Rect x={0} y={y} width={SLAT_TILE} height={1} fill={STEEL_LIGHT} />
      <Rect x={0} y={y + SLAT / 2} width={SLAT_TILE} height={1} fill={STEEL_FOLD} />
      <Rect x={0} y={y + SLAT - 2} width={SLAT_TILE} height={2} fill={STEEL_GROOVE} />
      <Rect x={slotX} y={y + 4} width={SLOT_W} height={3} rx={1.5} fill={SLOT} />
      <Rect x={slotX} y={y + 7} width={SLOT_W} height={1} fill={STEEL_LIGHT} />
    </>
  );
  return (
    <Svg style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <Pattern id="storiesShutter" width={SLAT_TILE} height={SLAT * 2} patternUnits="userSpaceOnUse">
          {slat(0, SLAT_TILE / 4 - SLOT_W / 2)}
          {slat(SLAT, (SLAT_TILE * 3) / 4 - SLOT_W / 2)}
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#storiesShutter)" />
    </Svg>
  );
});

/**
 * One story, a page the size of the whole stage: the whole photo centred in
 * its box (`box`), the same photo blurred filling the page behind it (the
 * tiny preview while it decrypts). The page's left and right halves are the
 * previous/next keys.
 */
const StoryPage = memo(function StoryPage({
  session,
  groupId,
  story,
  width,
  height,
  box,
  load,
  now,
  onTap,
  onView,
}: {
  session: Session;
  groupId: string;
  story: StoryMessage;
  width: number;
  height: number;
  box: { width: number; height: number };
  load: boolean;
  now: Date;
  onTap(side: 'left' | 'right'): void;
  onView(jpeg: Uint8Array): void;
}) {
  const loaded = useStoryImage(session, groupId, story, load);
  const uri = useMemo(() => (loaded.kind === 'ready' ? jpegUri(loaded.jpeg) : null), [loaded]);
  const preview = useMemo(() => {
    const p = story.story.preview;
    if (!p) return null;
    try {
      return safeToDisplay(b64.decode(p)) ? previewUri(p) : null;
    } catch {
      return null;
    }
  }, [story]);
  const left = Math.max(1, Math.ceil((storyExpiry(story).getTime() - now.getTime()) / 3_600_000));
  const who = story.mine ? 'toi' : story.senderName;
  const view = () => {
    if (loaded.kind === 'ready') onView(loaded.jpeg);
  };
  const backdrop = uri ?? preview;
  return (
    <View style={[styles.page, { width, height }]}>
      {backdrop ? <Image source={{ uri: backdrop }} style={styles.photo} blurRadius={uri ? 24 : 8} resizeMode="cover" /> : null}
      <View style={styles.dim} />
      <View style={[styles.box, { width: box.width, height: box.height }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.overlay}>
            {loaded.kind === 'error' ? <Text style={styles.error}>{loaded.message}</Text> : <ActivityIndicator color={colors.text} />}
          </View>
        )}
      </View>
      <Text style={styles.left}>{left} H</Text>
      <View style={styles.caption}>
        <Avatar id={isAvatarId(story.senderAvatar) ? story.senderAvatar : null} size={AVATAR} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {story.mine ? 'Toi' : story.senderName}
          </Text>
          <Text style={styles.ago} numberOfLines={1}>
            {agoLabel(new Date(story.createdAt), now)}
          </Text>
        </View>
      </View>
      <View style={styles.zones}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Story de ${who}, ${agoLabel(new Date(story.createdAt), now)}. Story précédente`}
          accessibilityHint="Appui long : plein écran"
          style={styles.zone}
          onPress={() => onTap('left')}
          onLongPress={view}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Story suivante"
          accessibilityHint="Appui long : plein écran"
          style={styles.zone}
          onPress={() => onTap('right')}
          onLongPress={view}
        />
      </View>
    </View>
  );
});

// Brushed steel, darker than the photos so they stand out on it.
const STEEL = '#1F2225';
const STEEL_LIGHT = 'rgba(255,255,255,0.10)';
const STEEL_FOLD = 'rgba(255,255,255,0.035)';
const STEEL_GROOVE = '#0B0C0D';
const SLOT = '#030303';

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
  // The photo's box, centred on its page over the blurred backdrop.
  page: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: STEEL,
  },
  // The backdrop toned down, so the photo itself stands out on it.
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  box: { overflow: 'hidden' },
  photo: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  error: {
    color: colors.text,
    fontSize: 12,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  // The two invisible keys over the photo: left half back, right half forward.
  zones: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  zone: { flex: 1 },
  left: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: colors.textDim,
    fontFamily: mono,
    fontSize: 9,
    letterSpacing: 1,
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  name: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
  ago: { color: colors.textDim, fontSize: 10, fontFamily: mono },
});
