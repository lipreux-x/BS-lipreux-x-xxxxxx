import { Camera, Mic, Paperclip } from 'lucide-react-native';
import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { accountTones } from '../accountColors';
import { Avatar, isAvatarId } from '../avatars';
import { Led, type LedState } from '../Led';
import type { ReactionId } from '@/crypto';
import { bevel, blade, colors, fonts, hotPlate, led, mono, space, steel, wash } from '../theme';
import type { ChatLook } from './look';
import { ReactionChips } from './ReactionKeys';
import type { ReactionCount } from './reactions';
import type { Quote } from './replies';

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

const STATUS_LED: Record<DeliveryStatus, LedState> = { sending: 'busy', sent: 'ok', failed: 'error' };
const STATUS_LABEL: Record<DeliveryStatus, string> = { sending: 'Envoi en cours', sent: 'Envoyé', failed: 'Échec de l’envoi' };

/**
 * How long a press on a message lasts to open its actions. What takes the
 * touch inside a message (photo, voice message, quote) gets the long press
 * too, with the same delay: the message itself never sees it.
 */
export const LONG_PRESS_MS = 300;
const DOUBLE_TAP_MS = 300;

/** The prompt before every entry, as in a terminal. */
const PROMPT = '❯';

/**
 * The conversation as a terminal session: every message is an entry in the
 * monospace font, under a prompt line `❯ author [time]`. Mine sit on the
 * right, lit in the hot green of the terminal; the others' on the left, in
 * the cold sky blue, each on a faint wash of its own light (green, blue).
 * The text of every entry is the same white, indented under its prompt.
 * No plates, no avatars. An author who picked a color (Settings) has their
 * prompt and name lit in it, and their entries washed with it.
 *
 * Footer in the prompt line: the time, and for mine the delivery LED (pale
 * while sending, blue once stored on the server, red failed).
 *
 * `look: 'plates'` (chosen per group): the message on a small plate of the
 * safe instead, bevelled like the keypad keys, green-tinted steel for mine,
 * dark metal for the others'. Theirs have the sender's avatar in a column on
 * the left and their name above the plate, on every message; the time and
 * the LED sit in the plate's footer. The corner on the sender's side is
 * squared off on the last message of a run. An author's color, when picked,
 * lights their name and tints their plates (a dark shade of it).
 *
 * A reply opens with the quoted message in a small recessed screen; tapping
 * it jumps to the original. A long press opens the message's actions.
 */
export function MessageBubble({
  look = 'terminal',
  mine,
  author,
  avatar,
  color,
  time,
  status,
  error,
  last,
  media,
  quote,
  highlighted,
  reactions,
  onRetry,
  onQuotePress,
  onLongPress,
  onReact,
  onDoubleTap,
  children,
}: {
  look?: ChatLook;
  mine: boolean;
  /** Name of the sender, mine included; "moi" when not known yet. */
  author?: string;
  /** Their avatar icon id (drawn on the plates only). */
  avatar?: string | null;
  /** Their account color id (null: the default of the side). */
  color?: string | null;
  time: string;
  status?: DeliveryStatus;
  /** Why the send failed, when known (e.g. "Image trop lourde"). */
  error?: string;
  /** Last message of a run: squared corner on the plates (no visible effect in the terminal). */
  last: boolean;
  /** Image content: the frame sits under the prompt like text; on a plate, a thin frame instead of the text padding. */
  media?: boolean;
  /** The message this one answers. */
  quote?: Quote;
  /** Briefly lit after jumping here from a quote. */
  highlighted?: boolean;
  /** What the message got, shown under it. */
  reactions?: ReactionCount[];
  onRetry?(): void;
  onQuotePress?(): void;
  /** Actions (reply, copy); absent for messages still on their way. */
  onLongPress?(): void;
  /** Tap on one of the reactions under the message: the same one (toggle). */
  onReact?(id: ReactionId): void;
  /** Two quick taps on the message: the first reaction of the phone's order. */
  onDoubleTap?(): void;
  children: ReactNode;
}) {
  const failed = status === 'failed';
  const tones = accountTones(color);
  const litText = tones ? { color: tones.lit } : null;
  const lastTap = useRef(0);
  const tap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onDoubleTap?.();
    } else {
      lastTap.current = now;
    }
  };
  const press = {
    disabled: !failed && !onLongPress && !onDoubleTap,
    onPress: failed ? onRetry : onDoubleTap ? tap : undefined,
    onLongPress,
    delayLongPress: LONG_PRESS_MS,
    accessibilityHint: failed ? 'Touche pour renvoyer' : onLongPress ? 'Appui long pour répondre' : undefined,
  };
  const statusLed = status ? (
    <View accessibilityLabel={STATUS_LABEL[status]}>
      <Led state={STATUS_LED[status]} size={6} />
    </View>
  ) : null;

  if (look === 'plates') {
    const column = (
      <View style={[plates.column, mine ? plates.columnMine : plates.columnTheirs]}>
        {!mine ? (
          <Text style={[plates.author, litText]} numberOfLines={1}>
            {author || '?'}
          </Text>
        ) : null}
        <Pressable
          {...press}
          style={[
            plates.plate,
            mine ? plates.mine : plates.theirs,
            tones && { backgroundColor: tones.face, ...bevel(tones.edgeLight, tones.edgeDark) },
            media && plates.media,
            last && (mine ? plates.tailMine : plates.tailTheirs),
            failed && plates.failed,
            highlighted && plates.highlighted,
          ]}
        >
          {quote ? <QuoteBlock look="plates" quote={quote} media={media} onPress={onQuotePress} onLongPress={onLongPress} /> : null}
          {children}
          <View style={[plates.footer, media && plates.footerMedia]}>
            <Text style={[plates.time, mine && plates.timeMine]}>{time}</Text>
            {statusLed}
          </View>
        </Pressable>
        {reactions?.length ? <ReactionChips counts={reactions} onPress={onReact} /> : null}
        {failed ? <Text style={plates.failure}>{`${error ?? 'Échec de l’envoi'} — touche pour renvoyer`}</Text> : null}
      </View>
    );
    if (mine) return <View style={plates.rowMine}>{column}</View>;
    return (
      <View style={plates.rowTheirs}>
        <Avatar id={isAvatarId(avatar) ? avatar : null} size={AVATAR} />
        {column}
      </View>
    );
  }

  return (
    <View style={[styles.entry, mine ? styles.entryMine : styles.entryTheirs]}>
      <Pressable
        {...press}
        style={[styles.line, mine ? styles.lineMine : styles.lineTheirs, tones && { backgroundColor: tones.wash }, highlighted && styles.highlighted, failed && styles.failed]}
      >
        <View style={[styles.prompt, mine && styles.promptMine]}>
          <Text style={[styles.promptChar, mine ? styles.hotText : styles.coldText, litText]}>{PROMPT}</Text>
          <Text style={[styles.author, mine ? styles.hotText : styles.coldText, litText]} numberOfLines={1}>
            {author || (mine ? 'moi' : '?')}
          </Text>
          <Text style={styles.time}>[{time}]</Text>
          {statusLed}
        </View>
        <View style={[styles.body, mine && styles.bodyMine]}>
          {quote ? <QuoteBlock quote={quote} media={media} onPress={onQuotePress} onLongPress={onLongPress} /> : null}
          {children}
        </View>
      </Pressable>
      {reactions?.length ? (
        <View style={styles.reactions}>
          <ReactionChips counts={reactions} onPress={onReact} />
        </View>
      ) : null}
      {failed ? <Text style={styles.failure}>{`${error ?? 'Échec de l’envoi'} — touche pour renvoyer`}</Text> : null}
    </View>
  );
}

/** The quoted message, as a terminal quote: a lit bar on the left, author and excerpt in the monospace font (on a plate, in a recessed screen, in the text font). */
export function QuoteBlock({
  look = 'terminal',
  quote,
  media,
  onPress,
  onLongPress,
}: {
  look?: ChatLook;
  quote: Quote;
  media?: boolean;
  onPress?(): void;
  onLongPress?(): void;
}) {
  const plate = look === 'plates';
  return (
    <Pressable
      disabled={!quote.found || !onPress}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      accessibilityRole="button"
      accessibilityLabel={`Réponse à ${quote.author}`}
      style={[styles.quote, media && styles.quoteMedia, plate && plates.quote, plate && media && plates.quoteMedia]}
    >
      <Text style={plate ? plates.quoteAuthor : styles.quoteAuthor} numberOfLines={1}>
        {quote.author}
      </Text>
      <QuoteExcerpt quote={quote} style={plate ? plates.quoteText : styles.quoteText} numberOfLines={2} />
    </Pressable>
  );
}

/** What a quoted message holds: its text, or an icon and a word for a photo, a voice message, a file. */
export function QuoteExcerpt({ quote, style, numberOfLines = 1 }: { quote: Quote; style: StyleProp<TextStyle>; numberOfLines?: number }) {
  const flat = StyleSheet.flatten(style) ?? {};
  const Icon = quote.image ? Camera : quote.voice ? Mic : quote.file ? Paperclip : null;
  const text = quote.image ? 'Photo' : quote.voice ? 'Vocal' : quote.excerpt;
  return (
    <View style={styles.excerpt}>
      {Icon ? <Icon size={(flat.fontSize ?? 13) + 1} color={flat.color ?? colors.textDim} strokeWidth={2.25} /> : null}
      <Text style={[style, styles.excerptText]} numberOfLines={numberOfLines}>
        {text}
      </Text>
    </View>
  );
}

/** Day label between runs of messages, as a comment line: "── AUJOURD'HUI ──". Long press: the admin's erase menu. */
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

/** Width of the prompt column: the text sits under the author, not under the prompt. */
const INDENT = 18;

const styles = StyleSheet.create({
  entry: { gap: 4, maxWidth: '88%' },
  entryMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  entryTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  line: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  // A faint wash of each side's light behind the entry.
  lineMine: { backgroundColor: wash.hot },
  lineTheirs: { backgroundColor: wash.cold },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  promptMine: { justifyContent: 'flex-end' },
  promptChar: { fontFamily: mono, fontSize: 15, width: INDENT - 6 },
  author: { fontFamily: mono, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  hotText: { color: blade.neon },
  coldText: { color: blade.sky },
  time: { fontFamily: mono, fontSize: 11, color: colors.textDim },
  body: { paddingLeft: INDENT, paddingTop: 2, alignItems: 'flex-start' },
  // Mine: the entry hangs from the right edge, its text still reads from the left.
  bodyMine: { alignItems: 'flex-end' },
  reactions: { paddingLeft: INDENT + 4 },
  // A failed entry: the red light on its left bar, the text held back.
  failed: { borderLeftColor: colors.danger, opacity: 0.8 },
  failure: { color: colors.danger, fontFamily: mono, fontSize: 11, paddingLeft: INDENT + 4 },
  highlighted: { borderLeftColor: led.busy, backgroundColor: wash.filament },
  // Recessed like the code display, with the edge lit in the cold light.
  quote: {
    marginBottom: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderLeftWidth: 2,
    borderLeftColor: colors.accentFg,
    minWidth: 140,
  },
  quoteMedia: { marginBottom: 4 },
  quoteAuthor: { color: colors.accentFg, fontFamily: mono, fontSize: 12 },
  quoteText: { color: colors.textDim, fontFamily: mono, fontSize: 13 },
  excerpt: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  excerptText: { flexShrink: 1 },
  day: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.sm },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dayLabel: { fontFamily: mono, fontSize: 10, letterSpacing: 2, color: colors.textDim },
});

const AVATAR = 32;

/** The plates of `look: 'plates'`. */
const plates = StyleSheet.create({
  rowMine: { alignSelf: 'flex-end', maxWidth: '82%' },
  rowTheirs: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: '88%' },
  column: { gap: 3, flexShrink: 1 },
  columnMine: { alignItems: 'flex-end' },
  columnTheirs: { alignItems: 'flex-start' },
  author: { color: blade.sky, fontSize: 13, fontFamily: fonts.semibold, marginLeft: 2 },
  plate: { borderRadius: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderWidth: 1 },
  mine: { backgroundColor: hotPlate.face, ...bevel(hotPlate.edgeLight, hotPlate.edgeDark) },
  theirs: { backgroundColor: steel.plate, ...bevel(steel.screw, steel.bezelDark) },
  media: { padding: 3 },
  tailMine: { borderBottomRightRadius: 3 },
  tailTheirs: { borderBottomLeftRadius: 3 },
  // Per-side colors win over borderColor in React Native: set each side.
  failed: { opacity: 0.75, ...bevel(colors.danger, colors.danger) },
  highlighted: bevel(led.busy, led.busy),
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  footerMedia: {
    position: 'absolute',
    right: 8,
    bottom: 6,
    marginTop: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  time: { fontFamily: mono, fontSize: 10, color: colors.textDim },
  timeMine: { color: 'rgba(255,255,255,0.65)' },
  failure: { color: colors.danger, fontSize: 11 },
  // Recessed like the code display, with the edge lit in the cold light.
  quote: { borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.35)', borderLeftWidth: 3 },
  quoteMedia: { margin: 3, marginBottom: 3 },
  quoteAuthor: { color: colors.text, fontSize: 12, fontFamily: fonts.semibold },
  quoteText: { color: colors.textDim, fontSize: 13 },
});
