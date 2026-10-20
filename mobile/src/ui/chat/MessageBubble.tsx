import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar, isAvatarId } from '../avatars';
import { Led, type LedState } from '../Led';
import { colors, fonts, led, mono, space } from '../theme';
import type { Quote } from './replies';

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

const STATUS_LED: Record<DeliveryStatus, LedState> = { sending: 'amber', sent: 'green', failed: 'red' };
const STATUS_LABEL: Record<DeliveryStatus, string> = { sending: 'Envoi en cours', sent: 'Envoyé', failed: 'Échec de l’envoi' };

/**
 * How long a press on a message lasts to open its actions. What takes the
 * touch inside a bubble (photo, voice message, quote) gets the long press
 * too, with the same delay: the bubble itself never sees it.
 */
export const LONG_PRESS_MS = 300;

/**
 * A message as a small plate of the safe: bevelled edges like the keypad
 * keys, anthracite for mine, darker metal for others. The corner on the
 * sender's side is squared off on the last message of a run. Footer: time
 * on the LCD font and, for mine, the delivery LED (amber sending, green
 * stored on the server, red failed).
 *
 * Others' messages have a column on the left with the sender's avatar, and
 * their name above the bubble, on every message.
 *
 * A reply opens with the quoted message in a small recessed screen; tapping
 * it jumps to the original. A long press opens the message's actions.
 */
export function MessageBubble({
  mine,
  author,
  avatar,
  time,
  status,
  error,
  last,
  media,
  quote,
  highlighted,
  onRetry,
  onQuotePress,
  onLongPress,
  children,
}: {
  mine: boolean;
  /** Name of someone else, shown with their avatar. */
  author?: string;
  /** Their avatar icon id. */
  avatar?: string | null;
  time: string;
  status?: DeliveryStatus;
  /** Why the send failed, when known (e.g. "Image trop lourde"). */
  error?: string;
  /** Last message of a run: squared corner on the sender's side. */
  last: boolean;
  /** Image content: thin frame instead of text padding. */
  media?: boolean;
  /** The message this one answers. */
  quote?: Quote;
  /** Briefly lit after jumping here from a quote. */
  highlighted?: boolean;
  onRetry?(): void;
  onQuotePress?(): void;
  /** Actions (reply, copy); absent for messages still on their way. */
  onLongPress?(): void;
  children: ReactNode;
}) {
  const failed = status === 'failed';
  const bubble = (
    <View style={[styles.column, mine ? styles.columnMine : styles.columnTheirs]}>
      {author ? (
        <Text style={styles.author} numberOfLines={1}>
          {author}
        </Text>
      ) : null}
      <Pressable
        disabled={!failed && !onLongPress}
        onPress={failed ? onRetry : undefined}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
        accessibilityHint={failed ? 'Touche pour renvoyer' : onLongPress ? 'Appui long pour répondre' : undefined}
        style={[
          styles.plate,
          mine ? styles.mine : styles.theirs,
          media && styles.media,
          last && (mine ? styles.tailMine : styles.tailTheirs),
          failed && styles.failed,
          highlighted && styles.highlighted,
        ]}
      >
        {quote ? <QuoteBlock quote={quote} media={media} onPress={onQuotePress} onLongPress={onLongPress} /> : null}
        {children}
        <View style={[styles.footer, media && styles.footerMedia]}>
          <Text style={[styles.time, mine && styles.timeMine]}>{time}</Text>
          {status ? (
            <View accessibilityLabel={STATUS_LABEL[status]}>
              <Led state={STATUS_LED[status]} size={6} />
            </View>
          ) : null}
        </View>
      </Pressable>
      {failed ? <Text style={styles.failure}>{`${error ?? 'Échec de l’envoi'} — touche pour renvoyer`}</Text> : null}
    </View>
  );
  if (mine) return <View style={styles.rowMine}>{bubble}</View>;
  return (
    <View style={styles.rowTheirs}>
      <View style={styles.avatarSlot}>{author ? <Avatar id={isAvatarId(avatar) ? avatar : null} size={AVATAR} /> : null}</View>
      {bubble}
    </View>
  );
}

/** The quoted message, in a recessed screen with a lit edge on the left. */
export function QuoteBlock({ quote, media, onPress, onLongPress }: { quote: Quote; media?: boolean; onPress?(): void; onLongPress?(): void }) {
  return (
    <Pressable
      disabled={!quote.found || !onPress}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      accessibilityRole="button"
      accessibilityLabel={`Réponse à ${quote.author}`}
      style={[styles.quote, media && styles.quoteMedia]}
    >
      <Text style={styles.quoteAuthor} numberOfLines={1}>
        {quote.author}
      </Text>
      <Text style={styles.quoteText} numberOfLines={2}>
        {quote.image ? '📷 Photo' : quote.voice ? '🎤 Vocal' : quote.excerpt}
      </Text>
    </Pressable>
  );
}

/** Engraved day label between runs of messages: "— AUJOURD'HUI —". Long press: the admin's erase menu. */
export function DaySeparator({ label, onLongPress }: { label: string; onLongPress?(): void }) {
  return (
    <Pressable
      style={styles.day}
      disabled={!onLongPress}
      onLongPress={onLongPress}
      accessibilityHint={onLongPress ? 'Appui long pour effacer les messages de ce jour' : undefined}
    >
      <View style={styles.rule} />
      <Text style={styles.dayLabel}>{label}</Text>
      <View style={styles.rule} />
    </Pressable>
  );
}

const AVATAR = 34;
const ANTHRACITE_LIGHT = '#565D63';
const ANTHRACITE_DARK = '#16191B';
const METAL_LIGHT = '#3A3F44';
const METAL_DARK = '#050505';

const styles = StyleSheet.create({
  rowMine: { alignSelf: 'flex-end', maxWidth: '82%' },
  rowTheirs: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: '88%' },
  avatarSlot: { width: AVATAR },
  column: { gap: 3, flexShrink: 1 },
  columnMine: { alignItems: 'flex-end' },
  columnTheirs: { alignItems: 'flex-start' },
  author: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold, marginLeft: 2 },
  plate: { borderRadius: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderWidth: 1 },
  mine: {
    backgroundColor: colors.accent,
    borderTopColor: ANTHRACITE_LIGHT,
    borderLeftColor: ANTHRACITE_LIGHT,
    borderBottomColor: ANTHRACITE_DARK,
    borderRightColor: ANTHRACITE_DARK,
  },
  theirs: {
    backgroundColor: '#1D2023',
    borderTopColor: METAL_LIGHT,
    borderLeftColor: METAL_LIGHT,
    borderBottomColor: METAL_DARK,
    borderRightColor: METAL_DARK,
  },
  media: { padding: 3 },
  tailMine: { borderBottomRightRadius: 3 },
  tailTheirs: { borderBottomLeftRadius: 3 },
  // Per-side colors win over borderColor in React Native: set each side.
  failed: {
    opacity: 0.75,
    borderTopColor: colors.danger,
    borderLeftColor: colors.danger,
    borderBottomColor: colors.danger,
    borderRightColor: colors.danger,
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  footerMedia: { position: 'absolute', right: 8, bottom: 6, marginTop: 0, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.55)' },
  time: { fontFamily: mono, fontSize: 10, color: colors.textDim },
  timeMine: { color: 'rgba(255,255,255,0.65)' },
  failure: { color: colors.danger, fontSize: 11 },
  highlighted: {
    borderTopColor: led.amber,
    borderLeftColor: led.amber,
    borderBottomColor: led.amber,
    borderRightColor: led.amber,
  },
  // Recessed like the code display, with the edge lit in the accent.
  quote: {
    marginBottom: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderLeftWidth: 3,
    borderLeftColor: colors.accentFg,
    minWidth: 140,
  },
  quoteMedia: { margin: 3, marginBottom: 3 },
  quoteAuthor: { color: colors.text, fontSize: 12, fontFamily: fonts.semibold },
  quoteText: { color: colors.textDim, fontSize: 13 },
  day: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.sm },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dayLabel: { fontFamily: mono, fontSize: 10, letterSpacing: 2, color: colors.textDim },
});
