import { Trash2 } from 'lucide-react-native';
import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { b64, type ReactionId } from '@/crypto';
import { ApiError } from '@/services/api';
import { loadAttachment, type Session } from '@/services/groups';
import { imageCache, jpegUri, previewUri } from '@/services/images';
import { safeToDisplay } from '@/services/jpeg';
import { Avatar, isAvatarId } from '../avatars';
import { colors, fonts, mono } from '../theme';
import { StoryReactions } from '../chat/ReactionKeys';
import type { ReactionCount } from '../chat/reactions';
import { agoLabel } from '../chat/timeline';
import type { StoryMessage } from './stories';

/** The avatar on a photo, the size of the chat's. */
const AVATAR = 34;
/** The shutter behind the photos: height of a slat, width of a tile, length of a vent slot. */
const SLAT = 12;
const SLAT_TILE = 36;
const SLOT_W = 14;

// Brushed steel, darker than the photos so they stand out on it.
export const STEEL = '#1F2225';
const STEEL_LIGHT = 'rgba(255,255,255,0.10)';
const STEEL_FOLD = 'rgba(255,255,255,0.035)';
const STEEL_GROOVE = '#0B0C0D';
const SLOT = '#030303';

type Loaded = { kind: 'loading' } | { kind: 'ready'; jpeg: Uint8Array } | { kind: 'error'; message: string };

/** The story's photo, downloaded and decrypted in memory (or from this session's cache), once `enabled`. */
export function useStoryImage(session: Session, groupId: string, story: StoryMessage, enabled: boolean): Loaded {
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
 * The metal shutter behind the photos, as the vent grille of a safe: steel
 * slats, each lit on its upper edge and closed by a dark groove, pierced
 * with vent slots staggered from one slat to the next.
 */
export const Shutter = memo(function Shutter() {
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
 * previous/next keys; the five reaction keys sit in its caption.
 */
export const StoryPage = memo(function StoryPage({
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
  reactions,
  order,
  onReact,
  onDelete,
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
  /** What this story got. */
  reactions: ReactionCount[] | undefined;
  order: ReactionId[];
  onReact(storyId: string, id: ReactionId): void;
  /** One of mine: delete it for everyone (asked first). */
  onDelete(storyId: string): void;
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
      {/* One of mine: a quiet delete key in the top right corner, above the page's keys (the red is for the confirmation). */}
      {story.mine ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Supprimer ta story"
          hitSlop={10}
          onPress={() => onDelete(story.id)}
          style={({ pressed }) => [styles.delete, pressed && styles.deletePressed]}
        >
          <Trash2 size={15} color={colors.textDim} strokeWidth={2} />
        </Pressable>
      ) : null}
      {/* Over the keys: a tap on the name still turns the page, the reaction keys take their own. */}
      <View style={styles.caption} pointerEvents="box-none">
        <View style={styles.who} pointerEvents="none">
          <Avatar id={isAvatarId(story.senderAvatar) ? story.senderAvatar : null} size={AVATAR} color={story.senderColor} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {story.mine ? 'Toi' : story.senderName}
            </Text>
            <Text style={styles.ago} numberOfLines={1}>
              {agoLabel(new Date(story.createdAt), now)}
            </Text>
          </View>
        </View>
        <StoryReactions order={order} counts={reactions} onPick={(id) => onReact(story.id, id)} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
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
  delete: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  deletePressed: { backgroundColor: 'rgba(0,0,0,0.7)' },
  zone: { flex: 1 },
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
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
  ago: { color: colors.textDim, fontSize: 10, fontFamily: mono },
});
