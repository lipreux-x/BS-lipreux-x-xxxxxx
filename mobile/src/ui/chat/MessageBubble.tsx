import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar, isAvatarId } from '../avatars';
import { Led, type LedState } from '../Led';
import { colors, fonts, mono, space } from '../theme';

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

const STATUS_LED: Record<DeliveryStatus, LedState> = { sending: 'amber', sent: 'green', failed: 'red' };
const STATUS_LABEL: Record<DeliveryStatus, string> = { sending: 'Envoi en cours', sent: 'Envoyé', failed: 'Échec de l’envoi' };

/**
 * A message as a small plate of the safe: bevelled edges like the keypad
 * keys, anthracite for mine, darker metal for others. The corner on the
 * sender's side is squared off on the last message of a run. Footer: time
 * on the LCD font and, for mine, the delivery LED (amber sending, green
 * stored on the server, red failed).
 *
 * Others' messages have a column on the left with the sender's avatar, and
 * their name above the bubble, on every message.
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
  onRetry,
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
  onRetry?(): void;
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
        disabled={!failed}
        onPress={onRetry}
        accessibilityHint={failed ? 'Touche pour renvoyer' : undefined}
        style={[
          styles.plate,
          mine ? styles.mine : styles.theirs,
          media && styles.media,
          last && (mine ? styles.tailMine : styles.tailTheirs),
          failed && styles.failed,
        ]}
      >
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

/** Engraved day label between runs of messages: "— AUJOURD'HUI —". */
export function DaySeparator({ label }: { label: string }) {
  return (
    <View style={styles.day}>
      <View style={styles.rule} />
      <Text style={styles.dayLabel}>{label}</Text>
      <View style={styles.rule} />
    </View>
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
  day: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.sm },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dayLabel: { fontFamily: mono, fontSize: 10, letterSpacing: 2, color: colors.textDim },
});
