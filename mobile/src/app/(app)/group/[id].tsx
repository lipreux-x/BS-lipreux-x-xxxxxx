import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '@/config';
import type { ImageBody, ReplyRef } from '@/crypto';
import { useUnlocked, type OpenGroup } from '@/session/SessionProvider';
import { ApiError, NetworkError, type WireMessage } from '@/services/api';
import {
  decryptMessages,
  fetchSince,
  ImageTooLargeError,
  listGroups,
  newClientId,
  sendImage,
  sendText,
  shareMissingKeys,
  relockGroup,
  syncGroup,
  unlockGroup,
  uploadImage,
  type ChatMessage,
  type GroupLockState,
  type PreparedImage,
} from '@/services/groups';
import { imageCache, pickImage } from '@/services/images';
import { RealtimeClient } from '@/services/realtime';
import { LockedOutError, WrongCodeError } from '@/services/vault';
import { Composer } from '@/ui/chat/Composer';
import { MessageActions } from '@/ui/chat/MessageActions';
import { DaySeparator, MessageBubble, type DeliveryStatus } from '@/ui/chat/MessageBubble';
import { replyRefFor, resolveQuote } from '@/ui/chat/replies';
import { SwipeToReply } from '@/ui/chat/SwipeToReply';
import { buildTimeline, timeLabel } from '@/ui/chat/timeline';
import { CodeEntry, type CodeResult } from '@/ui/CodeEntry';
import { ImageBubble, LocalImage } from '@/ui/ImageBubble';
import { ImageViewer } from '@/ui/ImageViewer';
import { Led } from '@/ui/Led';
import { colors, fonts, mono, space, type } from '@/ui/theme';

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { openGroups } = useUnlocked();
  const [open, setOpen] = useState<OpenGroup | undefined>(openGroups.get(id));
  const update = useCallback(
    (g: OpenGroup) => {
      openGroups.set(id, g);
      setOpen(g);
    },
    [openGroups, id],
  );

  return open ? <Chat groupId={id} group={open} onUpdate={update} /> : <GroupUnlock groupId={id} onOpen={update} />;
}

// ---- Unlock (SPEC §2.3) --------------------------------------------------------------

function GroupUnlock({ groupId, onOpen }: { groupId: string; onOpen(g: OpenGroup): void }) {
  const { session } = useUnlocked();
  const [state, setState] = useState<GroupLockState | null>(null);
  const [firstCode, setFirstCode] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  // Unlocked with the old code, but the admin changed it: ask for the new one.
  const [relock, setRelock] = useState<{ group: OpenGroup; first: string | null; mismatch: boolean } | null>(null);

  useEffect(() => {
    listGroups(session)
      .then((gs) => setState(gs.find((g) => g.id === groupId)?.state ?? { kind: 'waiting-key' }))
      .catch(() => setState({ kind: 'locked' }));
  }, [session, groupId]);

  async function attempt(code: string): Promise<CodeResult> {
    try {
      const res = await unlockGroup(session, groupId, code);
      if (!res) {
        setState({ kind: 'waiting-key' });
        return null;
      }
      const group = { keys: res.keys, keyVersion: res.keyVersion, name: res.meta.name };
      if (res.codeChanged) {
        setRelock({ group, first: null, mismatch: false });
        return null;
      }
      return () => onOpen(group);
    } catch (e) {
      if (e instanceof WrongCodeError) return 'Code incorrect';
      if (e instanceof LockedOutError) {
        setLockedFor(e.retryInMs);
        return 'Trop d’essais';
      }
      if (e instanceof NetworkError) return 'Pas de réseau';
      return 'Impossible d’ouvrir le groupe';
    }
  }

  if (relock) {
    const { group } = relock;
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Nouveau code' }} />
        {relock.first === null ? (
          <CodeEntry
            key="new"
            title="Le code du groupe a changé"
            subtitle="Entre le nouveau code, donné en vrai par l’admin."
            initialError={relock.mismatch ? 'Les codes ne correspondent pas' : undefined}
            onComplete={async (code) => {
              setRelock({ group, first: code, mismatch: false });
              return null;
            }}
          />
        ) : (
          <CodeEntry
            key="confirm-new"
            title="Confirme le nouveau code"
            onComplete={async (code) => {
              if (code !== relock.first) {
                setRelock({ group, first: null, mismatch: true });
                return null;
              }
              try {
                await relockGroup(session, groupId, group.keyVersion, group.keys.get(group.keyVersion)!, code);
                return () => onOpen(group);
              } catch (e) {
                return e instanceof NetworkError ? 'Pas de réseau' : 'Impossible d’enregistrer le code';
              }
            }}
          />
        )}
      </View>
    );
  }

  if (!state) return <SafeAreaView style={styles.center} />;

  if (state.kind === 'waiting-key') {
    return (
      <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
        <Stack.Screen options={{ title: 'Groupe verrouillé' }} />
        <Text style={type.heading}>En attente de la clé</Text>
        <Text style={[type.dim, { textAlign: 'center' }]}>
          Tu es membre. La clé du groupe arrivera chiffrée pour toi dès qu’un membre ouvrira le groupe sur son téléphone.
        </Text>
      </View>
    );
  }

  // First unlock: the code typed here becomes this phone's lock for the key. Ask twice.
  if (state.kind === 'first-unlock') {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Groupe verrouillé' }} />
        {firstCode === null ? (
          <CodeEntry
            key="code"
            initialError={mismatch ? 'Les codes ne correspondent pas' : undefined}
            title="Code du groupe"
            subtitle="La clé est arrivée. Entre le code du groupe pour la protéger sur ce téléphone."
            onComplete={async (code) => {
              setFirstCode(code);
              return null;
            }}
          />
        ) : (
          <CodeEntry
            key="confirm"
            title="Confirme le code"
            onComplete={async (code) => {
              if (code !== firstCode) {
                setMismatch(true);
                setFirstCode(null);
                return null;
              }
              return attempt(code);
            }}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Stack.Screen options={{ title: 'Groupe verrouillé' }} />
      <CodeEntry title="Code du groupe" onComplete={attempt} lockedForMs={lockedFor} />
    </View>
  );
}

// ---- Chat (SPEC §2.4) ------------------------------------------------------------------

type Pending = { clientId: string; at: string; failed: boolean; error?: string; replyTo?: ReplyRef } & (
  | { kind: 'text'; text: string }
  // `body` is set once the encrypted file is uploaded: a retry only resends the message.
  | { kind: 'image'; image: PreparedImage; body?: ImageBody }
);

function Chat({ groupId, group, onUpdate }: { groupId: string; group: OpenGroup; onUpdate(g: OpenGroup): void }) {
  const { session, profiles } = useUnlocked();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<Uint8Array | null>(null);
  // The message being answered (composer strip), and the one long-pressed (action sheet).
  const [replying, setReplying] = useState<ChatMessage | null>(null);
  const [pressed, setPressed] = useState<ChatMessage | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  // Where this screen starts below the top of the display (status bar + header):
  // what the keyboard avoider needs to keep the composer just above the keyboard.
  const headerHeight = useHeaderHeight();

  /** Answer `m`: reply strip above the composer, keyboard up. */
  function startReply(m: ChatMessage) {
    setReplying(m);
    input.current?.focus();
  }
  const [online, setOnline] = useState(true);
  const [removed, setRemoved] = useState(false);
  // History fetched once: until then an empty list means "loading", not "no messages".
  const [loaded, setLoaded] = useState(false);
  const lastSeq = useRef(0);
  const list = useRef<FlatList<Item>>(null);
  // Latest keys for callbacks that outlive a render (realtime, retries).
  const current = useRef(group);
  useEffect(() => {
    current.current = group;
  }, [group]);

  /** Rotation if a member left, keys rotated by others, key handout to new members. */
  const sync = useCallback(async (): Promise<OpenGroup> => {
    try {
      const r = await syncGroup(session, profiles, groupId, current.current.keys);
      const g = { keys: r.keys, keyVersion: r.keyVersion, name: r.meta.name };
      current.current = g;
      onUpdate(g);
      // Hand the key to members who joined since (they cannot read anything until then).
      await shareMissingKeys(session, profiles, groupId, r.keys.get(r.keyVersion)!, r.keyVersion).catch(() => {});
      return g;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setRemoved(true);
      return current.current;
    }
  }, [session, profiles, groupId, onUpdate]);

  const decrypt = useCallback(
    async (wire: WireMessage[]) => {
      let keys = current.current.keys;
      if (wire.some((m) => !keys.has(m.keyVersion))) keys = (await sync()).keys;
      return decryptMessages(session, profiles, keys, wire);
    },
    [session, profiles, sync],
  );

  // On open and when coming back from the group's settings.
  useFocusEffect(
    useCallback(() => {
      void sync();
    }, [sync]),
  );

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    lastSeq.current = Math.max(lastSeq.current, ...incoming.map((m) => m.seq));
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
    const done = new Set(incoming.map((m) => m.clientId));
    setPending((p) => p.filter((x) => !done.has(x.clientId)));
  }, []);

  const resync = useCallback(async () => {
    try {
      const wire = await fetchSince(session, groupId, lastSeq.current);
      merge(await decrypt(wire));
      setLoaded(true);
      setOnline(true);
    } catch (e) {
      if (e instanceof NetworkError) setOnline(false);
    }
  }, [session, groupId, decrypt, merge]);

  useEffect(() => {
    void resync();
    const rt = new RealtimeClient(API_URL, () => session.api.accessToken(), {
      onConnected: () => void resync(),
      onStatus: setOnline,
      onMessage: (m) => {
        if (m.groupId !== groupId) return;
        decrypt([m])
          .then(merge)
          .catch(() => void resync());
      },
    });
    rt.start();
    return () => rt.stop();
  }, [session, groupId, resync, decrypt, merge]);

  async function send(item: Pending) {
    const { clientId } = item;
    list.current?.scrollToOffset({ offset: 0, animated: true });
    setPending((p) => [...p.filter((x) => x.clientId !== clientId), { ...item, failed: false, error: undefined }]);
    try {
      let ready = item;
      if (ready.kind === 'image' && !ready.body) {
        // Encrypted on the phone with a fresh file key, then uploaded: the server only stores the blob.
        const body = await uploadImage(session, groupId, ready.image);
        ready = { ...ready, body };
        setPending((p) => p.map((x) => (x.clientId === clientId && x.kind === 'image' ? { ...x, body } : x)));
      }
      const attempt = (g: OpenGroup) =>
        ready.kind === 'text'
          ? sendText(session, groupId, g.keys.get(g.keyVersion)!, g.keyVersion, ready.text, clientId, ready.replyTo)
          : sendImage(session, groupId, g.keys.get(g.keyVersion)!, g.keyVersion, { ...ready.body!, ...(ready.replyTo && { replyTo: ready.replyTo }) }, clientId);
      let wire: WireMessage;
      try {
        wire = await attempt(current.current);
      } catch (e) {
        // The key was rotated since we opened the group: pick up the new one, send again.
        if (!(e instanceof ApiError && e.code === 'stale_key_version')) throw e;
        wire = await attempt(await sync());
      }
      // Our own image: no need to download what we just sent.
      if (ready.kind === 'image') imageCache.set(ready.body!.attachmentId, ready.image.jpeg);
      merge(await decrypt([wire]));
    } catch (e) {
      // Same clientId on retry: the server de-duplicates if the first send did land.
      const error = e instanceof ImageTooLargeError ? 'Image trop lourde' : undefined;
      setPending((p) => p.map((x) => (x.clientId === clientId ? { ...x, failed: true, error } : x)));
    }
  }

  /** The reply to attach to the next message, and clear it from the composer. */
  function takeReply(): ReplyRef | undefined {
    const ref = replying ? (replyRefFor(replying) ?? undefined) : undefined;
    setReplying(null);
    return ref;
  }

  async function sendPhoto() {
    setPicking(true);
    try {
      const image = await pickImage();
      if (image) void send({ clientId: newClientId(), at: new Date().toISOString(), kind: 'image', image, failed: false, replyTo: takeReply() });
    } catch {
      // Picker or re-encoding failed: nothing was sent.
    } finally {
      setPicking(false);
    }
  }

  if (removed) {
    return (
      <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
        <Stack.Screen options={{ title: group.name }} />
        <Text style={type.heading}>Tu ne fais plus partie de ce groupe</Text>
        <Text style={[type.dim, { textAlign: 'center' }]}>Un admin t’a retiré. Les nouveaux messages ne te sont plus accessibles.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.title}>
              <Led state="green" size={7} />
              <Text style={styles.titleText} numberOfLines={1}>
                {group.name}
              </Text>
            </View>
          ),
          headerRight: () => (
            <Pressable
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Réglages du groupe"
              onPress={() => router.push({ pathname: '/group/settings', params: { id: groupId } })}
            >
              <Text style={styles.headerButton}>⚙</Text>
            </Pressable>
          ),
        }}
      />
      {!online ? (
        <View style={styles.banner}>
          <Led state="amber" size={7} />
          <Text style={styles.bannerText}>HORS LIGNE — ENVOI AU RETOUR DU RÉSEAU</Text>
        </View>
      ) : null}
      {/* 'padding' on both platforms: with edge-to-edge (always on since SDK 54),
          Android no longer shrinks the window for the keyboard by itself. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <Timeline
          listRef={list}
          loaded={loaded}
          messages={messages}
          pending={pending}
          renderContent={(item) =>
            item.image ? (
              <ImageBubble session={session} groupId={groupId} body={item.image} onOpen={setViewing} />
            ) : item.local ? (
              <LocalImage jpeg={item.local.jpeg} width={item.local.width} height={item.local.height} />
            ) : item.text === null ? (
              <Text style={styles.unreadable}>Message illisible (signature ou clé invalide)</Text>
            ) : (
              <Text style={styles.text}>{item.text}</Text>
            )
          }
          onRetry={(p) => void send(p)}
          onLongPress={(m) => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setPressed(m);
          }}
          onReply={startReply}
        />
        <Composer
          value={draft}
          onChange={setDraft}
          attaching={picking}
          onAttach={() => void sendPhoto()}
          replyTo={replying ? resolveQuote(replyRefFor(replying)!, messages, session.account.userId) : null}
          onCancelReply={() => setReplying(null)}
          inputRef={input}
          onSend={() => {
            const text = draft.trim().replace(/^\u0000+/, ''); // a leading NUL marks structured bodies
            setDraft('');
            if (text) void send({ clientId: newClientId(), at: new Date().toISOString(), kind: 'text', text, failed: false, replyTo: takeReply() });
          }}
        />
      </KeyboardAvoidingView>
      <ImageViewer jpeg={viewing} onClose={() => setViewing(null)} />
      <MessageActions
        target={pressed ? { quote: resolveQuote(replyRefFor(pressed)!, messages, session.account.userId), text: pressed.text } : null}
        onReply={() => pressed && startReply(pressed)}
        onClose={() => setPressed(null)}
      />
    </SafeAreaView>
  );
}

// ---- Timeline --------------------------------------------------------------------------

/** One line of the chat, sent or still on its way. */
interface Line {
  key: string;
  senderId: string;
  at: Date;
  mine: boolean;
  author: string;
  avatar?: string | null;
  text: string | null;
  image?: ImageBody;
  local?: PreparedImage;
  status?: DeliveryStatus;
  pending?: Pending;
  replyTo?: ReplyRef;
  /** Delivered message: can be answered (long press). */
  message?: ChatMessage;
}

type Item = ReturnType<typeof buildTimeline<Line>>[number];

function Timeline({
  listRef,
  loaded,
  messages,
  pending,
  renderContent,
  onRetry,
  onLongPress,
  onReply,
}: {
  listRef: React.RefObject<FlatList<Item> | null>;
  loaded: boolean;
  messages: ChatMessage[];
  pending: Pending[];
  renderContent(line: Line): React.ReactNode;
  onRetry(p: Pending): void;
  onLongPress(m: ChatMessage): void;
  /** Swipe right on a delivered message. */
  onReply(m: ChatMessage): void;
}) {
  const { session } = useUnlocked();
  const me = session.account.userId;
  // Original lit for a moment after tapping a quote.
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  // Newest first: the list is inverted so it opens on the latest message.
  const items = useMemo(() => {
    const lines: Line[] = [
      ...messages.map((m) => ({
        key: m.id,
        senderId: m.senderId,
        at: new Date(m.createdAt),
        mine: m.mine,
        author: m.senderName,
        avatar: m.senderAvatar,
        text: m.text,
        image: m.image ?? undefined,
        status: m.mine ? ('sent' as const) : undefined,
        replyTo: m.replyTo ?? undefined,
        // Unreadable messages cannot be quoted.
        message: m.text !== null || m.image ? m : undefined,
      })),
      ...pending.map((p) => ({
        key: p.clientId,
        senderId: me,
        at: new Date(p.at),
        mine: true,
        author: '',
        text: p.kind === 'text' ? p.text : null,
        local: p.kind === 'image' ? p.image : undefined,
        status: p.failed ? ('failed' as const) : ('sending' as const),
        pending: p,
        replyTo: p.replyTo,
      })),
    ];
    return buildTimeline(lines, new Date()).reverse();
  }, [messages, pending, me]);

  function jumpTo(messageId: string) {
    const index = items.findIndex((i) => i.kind === 'message' && i.key === messageId);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setHighlight(messageId);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1500);
  }

  return (
    <FlatList
      ref={listRef}
      inverted
      data={items}
      keyExtractor={(i) => i.key}
      onScrollToIndexFailed={(info) => {
        // Row not measured yet: get close, then aim again once it is rendered.
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 100);
      }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.timeline}
      ListEmptyComponent={
        // Inverted list: flip the empty state back upright.
        !loaded ? undefined : <View style={[styles.empty, { transform: [{ scaleY: -1 }] }]}>
          <Text style={styles.emptyIcon}>🔓</Text>
          <Text style={styles.emptyTitle}>Coffre ouvert</Text>
          <Text style={[type.dim, { textAlign: 'center' }]}>
            Les messages et les photos sont chiffrés sur ton téléphone. Seuls les membres du groupe peuvent les lire.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        if (item.kind === 'day') return <DaySeparator label={item.label} />;
        const { message: line } = item;
        // Others' messages each carry the sender's avatar and name, so who wrote
        // what is never in doubt; only mine are grouped in runs.
        const last = !line.mine || item.last;
        return (
          <View style={last ? styles.runEnd : undefined}>
            <SwipeToReply onReply={line.message ? () => onReply(line.message!) : undefined}>
              <MessageBubble
                mine={line.mine}
                author={line.mine ? undefined : line.author}
                avatar={line.avatar}
                time={timeLabel(line.at)}
                status={line.status}
                error={line.pending?.error}
                last={last}
                media={!!(line.image || line.local)}
                quote={line.replyTo ? resolveQuote(line.replyTo, messages, me) : undefined}
                highlighted={highlight === line.key}
                onRetry={line.pending ? () => onRetry(line.pending!) : undefined}
                onQuotePress={line.replyTo ? () => jumpTo(line.replyTo!.messageId) : undefined}
                onLongPress={line.message ? () => onLongPress(line.message!) : undefined}
              >
                {renderContent(line)}
              </MessageBubble>
            </SwipeToReply>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 220 },
  titleText: { color: colors.text, fontSize: 17, fontFamily: fonts.semibold },
  headerButton: { color: colors.accentFg, fontSize: 24 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bannerText: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: colors.textDim },
  timeline: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 3, flexGrow: 1 },
  runEnd: { marginBottom: space.sm },
  text: { color: colors.text, fontSize: 16, lineHeight: 21 },
  unreadable: { color: colors.textDim, fontStyle: 'italic', fontSize: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  emptyIcon: { fontSize: 32 },
  emptyTitle: { color: colors.text, fontSize: 18, fontFamily: fonts.semibold },
});
