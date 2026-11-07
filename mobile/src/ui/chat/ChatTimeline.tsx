import { LockKeyholeOpen } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { FileBody, ImageBody, ReactionId, ReplyRef, VoiceBody } from '@/crypto';
import { useUnlocked } from '@/session/SessionProvider';
import type { ChatMessage, PreparedFile, PreparedImage, PreparedVoice } from '@/services/groups';
import { colorIn, type GroupColors } from '@/services/groupColors';
import type { Pending } from '@/services/outbox';
import type { ReactionCount } from './reactions';
import type { ChatLook } from './look';
import { DaySeparator, MessageBubble, type DeliveryStatus } from './MessageBubble';
import { quoteResolver, replyRefFor, type Quote } from './replies';
import { SwipeToReply } from './SwipeToReply';
import { buildTimeline, timeLabel } from './timeline';
import { colors, fonts, led, space, type } from '../theme';

/** How far the history is dragged before the keyboard goes away. */
const KEYBOARD_DRAG = 28;

/** One line of the chat, sent or still on its way. */
export interface Line {
  key: string;
  senderId: string;
  at: Date;
  mine: boolean;
  author: string;
  avatar?: string | null;
  /** The author's account color id. */
  color?: string | null;
  text: string | null;
  image?: ImageBody;
  local?: PreparedImage;
  voice?: VoiceBody;
  localVoice?: PreparedVoice;
  file?: FileBody;
  localFile?: PreparedFile;
  /** What it got (delivered messages only). */
  reactions?: ReactionCount[];
  status?: DeliveryStatus;
  pending?: Pending;
  replyTo?: ReplyRef;
  /** How `replyTo` shows, resolved against the loaded messages. */
  quote?: Quote;
  /** Delivered message: can be answered (long press). */
  message?: ChatMessage;
  /** A reaction to the story quoted (`quote`), shown as a line of its own. */
  storyReaction?: ReactionId;
  /** Deleted by its sender: « message supprimé » in its place. */
  deleted?: boolean;
}

export type Item = ReturnType<typeof buildTimeline<Line>>[number];

const itemKey = (i: Item) => i.key;

export const Timeline = memo(function Timeline({
  look,
  direct,
  listRef,
  loaded,
  messages,
  pending,
  renderContent,
  onRetry,
  onLongPress,
  onReply,
  onDayLongPress,
  reactions,
  onReact,
  onDoubleTap,
  colors: groupColors,
  stories,
  storyReactions,
  onStoryQuote,
  readMark,
}: {
  look: ChatLook;
  /** A private conversation: only the two of them read it. */
  direct: boolean;
  listRef: React.RefObject<FlatList<Item> | null>;
  loaded: boolean;
  messages: ChatMessage[];
  pending: Pending[];
  /** `onLongPress`: for the content that takes the touch (photo, voice message). */
  renderContent(line: Line, onLongPress?: () => void): React.ReactNode;
  onRetry(p: Pending): void;
  onLongPress(m: ChatMessage): void;
  /** Swipe right on a delivered message. */
  onReply(m: ChatMessage): void;
  /** Long press on a day separator (admins: erase menu). */
  onDayLongPress?(day: Date): void;
  /** Per message id, what it got. */
  reactions: ReadonlyMap<string, ReactionCount[]>;
  /** Tap on a reaction under a message, or one of the keys in its panel. */
  onReact(m: ChatMessage, id: ReactionId): void;
  /** Two quick taps on a delivered message: the first reaction of this phone's order. */
  onDoubleTap(m: ChatMessage): void;
  /** Each member's color in this group (null: not known yet, the profiles' then). */
  colors: GroupColors | null;
  /** The stories (in the band, not in the list): a reply to one quotes it. */
  stories: ChatMessage[];
  /** Each member's latest reaction to each story (reaction messages): a line each, quoting the story. */
  storyReactions: ChatMessage[];
  /** Tap on the quote of a story: show it. */
  onStoryQuote(storyId: string): void;
  /** The last message seen on this phone before the conversation opened: « nouveaux messages » after it. */
  readMark: number | null;
}) {
  const { session, profiles } = useUnlocked();
  const me = session.account.userId;
  const myName = session.account.username;
  // My color in this group, for my messages still on their way (the sent ones get it with the others').
  const [profileColor, setProfileColor] = useState<string | null>(null);
  useEffect(() => {
    profiles
      .get([me])
      .then((known) => setProfileColor(known.get(me)?.color ?? null))
      .catch(() => {});
  }, [profiles, me]);
  const myColor = colorIn(groupColors, me, profileColor);
  // Original lit for a moment after tapping a quote.
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  // Newest first: the list is inverted so it opens on the latest message.
  const items = useMemo(() => {
    // Quotes resolved here, once per change of the history, not on each render of each row.
    const quoteOf = quoteResolver(stories.length ? [...messages, ...stories] : messages, me);
    const reacted: Line[] = storyReactions.flatMap((m) => {
      const story = stories.find((s) => s.id === m.reaction?.messageId);
      const ref = story && replyRefFor(story);
      if (!ref || !m.reaction?.reaction) return [];
      const line: Line = {
        key: m.id,
        senderId: m.senderId,
        at: new Date(m.createdAt),
        mine: m.mine,
        author: m.senderName,
        avatar: m.senderAvatar,
        color: m.senderColor,
        text: null,
        storyReaction: m.reaction.reaction,
        replyTo: ref,
        quote: quoteOf(ref),
      };
      return [line];
    });
    const delivered: Line[] = [
      ...messages.map((m) => ({
        key: m.id,
        senderId: m.senderId,
        at: new Date(m.createdAt),
        mine: m.mine,
        author: m.senderName,
        avatar: m.senderAvatar,
        color: m.senderColor,
        text: m.text,
        image: m.image ?? undefined,
        voice: m.voice ?? undefined,
        file: m.file ?? undefined,
        reactions: m.deleted ? undefined : reactions.get(m.id),
        status: m.mine ? ('sent' as const) : undefined,
        replyTo: m.replyTo ?? undefined,
        quote: m.replyTo ? quoteOf(m.replyTo) : undefined,
        deleted: m.deleted,
        // Unreadable (or deleted) messages cannot be quoted.
        message: !m.deleted && (m.text !== null || m.image || m.voice || m.file) ? m : undefined,
      })),
    ];
    // In the order they happened, among the messages (a stable sort keeps the messages' own).
    if (reacted.length) {
      delivered.push(...reacted);
      delivered.sort((a, b) => a.at.getTime() - b.at.getTime());
    }
    const lines: Line[] = [
      ...delivered,
      ...pending.map((p) => ({
        key: p.clientId,
        senderId: me,
        at: new Date(p.at),
        mine: true,
        author: myName,
        color: myColor,
        text: p.kind === 'text' ? p.text : null,
        local: p.kind === 'image' ? p.image : undefined,
        localVoice: p.kind === 'voice' ? p.voice : undefined,
        localFile: p.kind === 'file' ? p.file : undefined,
        status: p.failed ? ('failed' as const) : ('sending' as const),
        pending: p,
        replyTo: p.replyTo,
        quote: p.replyTo ? quoteOf(p.replyTo) : undefined,
      })),
    ];
    // Someone else's first message after the mark (none: nothing new since).
    const firstUnread = readMark === null ? null : (messages.find((m) => m.seq > readMark && !m.mine && !m.deleted)?.id ?? null);
    return buildTimeline(lines, new Date(), firstUnread).reverse();
  }, [messages, stories, storyReactions, pending, me, myName, myColor, reactions, readMark]);

  const jumpTo = useCallback(
    (messageId: string) => {
      const index = items.findIndex((i) => i.kind === 'message' && i.key === messageId);
      if (index < 0) {
        if (stories.some((s) => s.id === messageId)) onStoryQuote(messageId);
        return;
      }
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      setHighlight(messageId);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlight(null), 1500);
    },
    [items, listRef, stories, onStoryQuote],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Item>) => {
      if (item.kind === 'day') {
        return <DaySeparator label={item.label} onLongPress={onDayLongPress ? () => onDayLongPress(item.at) : undefined} />;
      }
      if (item.kind === 'unread') return <DaySeparator label="NOUVEAUX MESSAGES" fresh />;
      const { message: line } = item;
      // Others' messages each carry the sender's avatar and name, so who wrote
      // what is never in doubt; only mine are grouped in runs.
      return (
        <TimelineRow
          look={look}
          line={line}
          last={!line.mine || item.last}
          highlighted={highlight === line.key}
          renderContent={renderContent}
          onRetry={onRetry}
          onLongPress={onLongPress}
          onReply={onReply}
          onReact={onReact}
          onDoubleTap={onDoubleTap}
          onQuotePress={jumpTo}
        />
      );
    },
    [look, highlight, renderContent, onRetry, onLongPress, onReply, onDayLongPress, jumpTo, onReact, onDoubleTap],
  );

  const dragFrom = useRef<number | null>(null);
  const startDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    dragFrom.current = Keyboard.isVisible() ? e.nativeEvent.contentOffset.y : null;
  }, []);
  const dragged = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (dragFrom.current === null || Math.abs(e.nativeEvent.contentOffset.y - dragFrom.current) < KEYBOARD_DRAG) return;
    dragFrom.current = null;
    Keyboard.dismiss();
  }, []);
  const endDrag = useCallback(() => {
    dragFrom.current = null;
  }, []);

  return (
    <FlatList
      ref={listRef}
      inverted
      data={items}
      keyExtractor={itemKey}
      onScrollToIndexFailed={(info) => {
        // Row not measured yet: get close, then aim again once it is rendered.
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 100);
      }}
      keyboardShouldPersistTaps="handled"
      // Scrolling back through the conversation puts the keyboard away (the whole screen for
      // reading), after a short slide: a light touch on the list leaves it up.
      onScrollBeginDrag={startDrag}
      onScroll={dragged}
      onScrollEndDrag={endDrag}
      scrollEventThrottle={16}
      contentContainerStyle={styles.timeline}
      ListEmptyComponent={
        // The list flips its empty state back upright by itself (inversionStyle in VirtualizedList).
        !loaded ? undefined : (
          <View style={styles.empty}>
            <LockKeyholeOpen size={36} color={led.ok} />
            <Text style={styles.emptyTitle}>Coffre ouvert</Text>
            <Text style={[type.dim, { textAlign: 'center' }]}>
              Les messages, les photos et les vocaux sont chiffrés sur ton téléphone.{' '}
              {direct ? 'Vous seuls, tous les deux, pouvez les lire.' : 'Seuls les membres du groupe peuvent les lire.'}
            </Text>
          </View>
        )
      }
      renderItem={renderItem}
    />
  );
});

/** A message of the timeline: re-rendered when it changes, not on every render of the list. */
const TimelineRow = memo(function TimelineRow({
  look,
  line,
  last,
  highlighted,
  renderContent,
  onRetry,
  onLongPress,
  onReply,
  onReact,
  onDoubleTap,
  onQuotePress,
}: {
  look: ChatLook;
  line: Line;
  last: boolean;
  highlighted: boolean;
  renderContent(line: Line, onLongPress?: () => void): React.ReactNode;
  onRetry(p: Pending): void;
  onLongPress(m: ChatMessage): void;
  onReply(m: ChatMessage): void;
  onReact(m: ChatMessage, id: ReactionId): void;
  onDoubleTap(m: ChatMessage): void;
  /** Tap on the quote: to the original (by id). */
  onQuotePress(messageId: string): void;
}) {
  const { message, pending, replyTo } = line;
  const longPress = message ? () => onLongPress(message) : undefined;
  return (
    <View style={last ? styles.runEnd : undefined}>
      <SwipeToReply onReply={message ? () => onReply(message) : undefined}>
        <MessageBubble
          look={look}
          mine={line.mine}
          author={line.author}
          avatar={line.avatar}
          color={line.color}
          time={timeLabel(line.at)}
          status={line.status}
          error={pending?.error}
          last={last}
          media={!!(line.image || line.local)}
          quote={line.quote}
          highlighted={highlighted}
          reactions={line.reactions}
          onRetry={pending ? () => onRetry(pending) : undefined}
          onQuotePress={replyTo ? () => onQuotePress(replyTo.messageId) : undefined}
          onLongPress={longPress}
          onReact={message ? (id) => onReact(message, id) : undefined}
          onDoubleTap={message ? () => onDoubleTap(message) : undefined}
        >
          {renderContent(line, longPress)}
        </MessageBubble>
      </SwipeToReply>
    </View>
  );
});

const styles = StyleSheet.create({
  timeline: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 3, flexGrow: 1 },
  runEnd: { marginBottom: space.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  emptyTitle: { color: colors.text, fontSize: 18, fontFamily: fonts.semibold },
});
