import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '@/config';
import type { ImageBody, ReplyRef, VoiceBody } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { useUnlocked, type OpenGroup } from '@/session/SessionProvider';
import { useInsideGroup } from '@/session/useInsideGroup';
import { ApiError, NetworkError, type WireMessage } from '@/services/api';
import {
  approveMember,
  AttachmentTooLargeError,
  decryptMessages,
  fetchSince,
  forgetGroup,
  GroupTamperedError,
  joinRequests,
  KeyChangedError,
  listGroups,
  newClientId,
  rejectMember,
  sendAttachment,
  sendText,
  relockGroup,
  syncGroup,
  unlockGroup,
  uploadImage,
  uploadVoice,
  type ChatMessage,
  type GroupLockState,
  type JoinRequestInfo,
  type PreparedImage,
  type PreparedVoice,
} from '@/services/groups';
import { imageCache, pickImage } from '@/services/images';
import { records, type LocalStore } from '@/services/localStore';
import { loadOutbox, saveOutbox, type Pending } from '@/services/outbox';
import { useVoiceRecorder, voiceCache, voicePlayer } from '@/services/voice';
import { RealtimeClient } from '@/services/realtime';
import { LockedOutError, WrongCodeError } from '@/services/vault';
import { Composer } from '@/ui/chat/Composer';
import { ActionKey, ActionSheet, MessageActions } from '@/ui/chat/MessageActions';
import { DaySeparator, MessageBubble, type DeliveryStatus } from '@/ui/chat/MessageBubble';
import { replyRefFor, resolveQuote } from '@/ui/chat/replies';
import { SwipeToReply } from '@/ui/chat/SwipeToReply';
import { buildTimeline, countdownLabel, dateTimeLabel, dayLabel, dayRange, timeLabel } from '@/ui/chat/timeline';
import { CodeEntry, type CodeResult } from '@/ui/CodeEntry';
import { ImageBubble, LocalImage } from '@/ui/ImageBubble';
import { ImageViewer } from '@/ui/ImageViewer';
import { KeywordsForm } from '@/ui/KeywordsForm';
import { SentVoice, VoiceBubble, voiceTrack } from '@/ui/VoiceBubble';
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
  // Closed while away (10 min out of it): its code again.
  useInsideGroup(id, useCallback(() => setOpen(openGroups.get(id)), [openGroups, id]));

  return open ? <Chat groupId={id} group={open} onUpdate={update} /> : <GroupUnlock groupId={id} onOpen={update} />;
}

// ---- Unlock (SPEC §2.3) --------------------------------------------------------------

/** What to tell the user when the server's data does not check out. */
function securityMessage(e: unknown): string | null {
  if (e instanceof KeyChangedError) return 'La clé d’un membre a changé : ouverture bloquée par sécurité';
  if (e instanceof GroupTamperedError) {
    return e.reason === 'keywords_mismatch' ? 'Mots-clés incorrects' : 'Données du groupe invalides : ouverture bloquée par sécurité';
  }
  return null;
}

function GroupUnlock({ groupId, onOpen }: { groupId: string; onOpen(g: OpenGroup): void }) {
  const { session, profiles } = useUnlocked();
  const [state, setState] = useState<GroupLockState | null>(null);
  // Signed in again on this phone: the keywords are needed once, with the code.
  const [keywords, setKeywords] = useState<string[] | null>(null);
  const [firstCode, setFirstCode] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  // Unlocked with the old code, but the admin changed it: ask for the new one.
  const [relock, setRelock] = useState<{ group: OpenGroup; first: string | null; mismatch: boolean } | null>(null);
  // No longer listed: self-destructed, or we were removed (listGroups erased what the phone kept).
  const [gone, setGone] = useState(false);

  useEffect(() => {
    listGroups(session)
      .then(({ items }) => {
        const g = items.find((x) => x.id === groupId);
        if (!g) setGone(true);
        setState(g?.state ?? { kind: 'locked' });
      })
      .catch(() => setState({ kind: 'locked' }));
  }, [session, groupId]);

  async function attempt(code: string): Promise<CodeResult> {
    try {
      const res = await unlockGroup(session, profiles, groupId, code, keywords ?? undefined);
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
      if (e instanceof WrongCodeError) return keywords ? 'Code ou mots-clés incorrects' : 'Code incorrect';
      if (e instanceof LockedOutError) {
        setLockedFor(e.retryInMs);
        return 'Trop d’essais';
      }
      if (e instanceof NetworkError) return 'Pas de réseau';
      return securityMessage(e) ?? 'Impossible d’ouvrir le groupe';
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
                // The new code must open the key the admin re-wrapped with it: a wrong one is refused here.
                const r = await relockGroup(session, profiles, groupId, group.keys, code);
                const opened = { keys: r.keys, keyVersion: r.keyVersion, name: r.meta.name };
                return () => onOpen(opened);
              } catch (e) {
                if (e instanceof WrongCodeError) {
                  setRelock({ group, first: null, mismatch: false });
                  return 'Ce n’est pas le nouveau code';
                }
                if (e instanceof LockedOutError) return 'Trop d’essais, réessaie plus tard';
                if (e instanceof NetworkError) return 'Pas de réseau';
                return securityMessage(e) ?? 'Impossible d’enregistrer le code';
              }
            }}
          />
        )}
      </View>
    );
  }

  if (gone) return <GroupGone />;

  if (!state) return <SafeAreaView style={styles.center} />;

  if (state.kind === 'pending') {
    return (
      <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
        <Stack.Screen options={{ title: 'Demande envoyée' }} />
        <Text style={type.heading}>En attente d’un admin</Text>
        <Text style={[type.dim, { textAlign: 'center' }]}>
          Ta demande est arrivée. Un admin du groupe doit l’accepter depuis son téléphone. Pour qu’il soit sûr que c’est bien toi, montre-lui ton
          numéro de sécurité (Réglages) : il le compare avec celui qu’il voit.
        </Text>
      </View>
    );
  }

  if (state.kind === 'waiting-key') {
    return (
      <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
        <Stack.Screen options={{ title: 'Groupe verrouillé' }} />
        <Text style={type.heading}>En attente de la clé</Text>
        <Text style={[type.dim, { textAlign: 'center' }]}>
          Tu es membre. La nouvelle clé du groupe arrivera chiffrée pour toi dès qu’un admin ouvrira le groupe sur son téléphone.
        </Text>
      </View>
    );
  }

  // Signed in again: this phone does not know the keywords yet. They come first, then the code.
  if (state.kind === 'first-unlock' && state.needsKeywords && !keywords) {
    return (
      <View style={[styles.center, { padding: space.lg }]}>
        <Stack.Screen options={{ title: 'Groupe verrouillé' }} />
        <KeywordsForm
          hint="Tu t’es reconnecté sur ce téléphone : entre les 3 mots-clés du groupe, puis son code."
          submitTitle="Continuer"
          onSubmit={async (words) => {
            setKeywords(words);
            return null;
          }}
        />
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

/** The group no longer exists for us: self-destructed (or we were removed). */
function GroupGone() {
  return (
    <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
      <Stack.Screen options={{ title: 'Groupe effacé' }} />
      <Text style={styles.emptyIcon}>💥</Text>
      <Text style={type.heading}>Ce groupe n’existe plus</Text>
      <Text style={[type.dim, { textAlign: 'center' }]}>
        Il s’est autodétruit ou tu n’en fais plus partie. Ses messages, ses photos, ses vocaux et ses clés ont été effacés de ce téléphone.
      </Text>
    </View>
  );
}

const ERASE_SPANS: { days: number; label: string }[] = [
  { days: 1, label: 'Ce jour' },
  { days: 2, label: 'Ce jour et la veille' },
  { days: 7, label: 'Les 7 jours jusqu’à ce jour' },
];

function Chat({ groupId, group, onUpdate }: { groupId: string; group: OpenGroup; onUpdate(g: OpenGroup): void }) {
  const { session, profiles, openGroups } = useUnlocked();
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
  // From the server at each sync: only admins erase days; self-destruct date if any.
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [destroyed, setDestroyed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // Day long-pressed by an admin: the erase menu is open for it.
  const [eraseDay, setEraseDay] = useState<Date | null>(null);
  // Latest erase of the history we have seen; null until the first fetch.
  const purgeSeq = useRef<number | null>(null);
  // History fetched once: until then an empty list means "loading", not "no messages".
  const [loaded, setLoaded] = useState(false);
  const lastSeq = useRef(0);
  const list = useRef<FlatList<Item>>(null);
  // Latest keys for callbacks that outlive a render (realtime, retries).
  const current = useRef(group);
  useEffect(() => {
    current.current = group;
  }, [group]);

  // Admin: people waiting to be let in (the sheet is open while `reviewing` is set).
  const [requests, setRequests] = useState<JoinRequestInfo[]>([]);
  const [reviewing, setReviewing] = useState(false);
  // What the server sent did not check out (keys refused): shown, never silently used.
  const [alert, setAlert] = useState<string | null>(null);
  const [newAdmin, setNewAdmin] = useState(false);

  /** Rotation if a member left (admin), keys rotated by an admin, join requests (admin). */
  const sync = useCallback(async (): Promise<OpenGroup> => {
    try {
      const r = await syncGroup(session, profiles, groupId, current.current.keys);
      const admin = r.meta.admins.includes(session.account.userId);
      setRole(admin ? 'admin' : 'member');
      setExpiresAt(r.summary.expiresAt ? new Date(r.summary.expiresAt) : null);
      if (r.adminChanged) setNewAdmin(true);
      setAlert(null);
      const g = { keys: r.keys, keyVersion: r.keyVersion, name: r.meta.name };
      current.current = g;
      onUpdate(g);
      setRequests(admin ? await joinRequests(session, profiles, groupId).catch(() => []) : []);
      return g;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setRemoved(true);
      const message = securityMessage(e);
      if (message) setAlert(message);
      return current.current;
    }
  }, [session, profiles, groupId, onUpdate]);

  async function decide(r: JoinRequestInfo, accept: boolean) {
    try {
      if (accept) await approveMember(session, profiles, groupId, current.current.keys, r.userId);
      else await rejectMember(session, groupId, r.userId);
      setRequests((list) => list.filter((x) => x.userId !== r.userId));
      void sync();
    } catch (e) {
      Alert.alert(
        accept ? 'Impossible d’accepter' : 'Impossible de refuser',
        e instanceof NetworkError ? 'Pas de réseau.' : (securityMessage(e) ?? 'Réessaie dans un instant.'),
      );
    }
  }

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

  // A voice message that ends hands over to the next one of the conversation;
  // leaving the conversation (settings, back to the list) stops the listening.
  const delivered = useRef<ChatMessage[]>([]);
  useEffect(() => {
    delivered.current = messages;
  }, [messages]);
  useFocusEffect(
    useCallback(() => {
      voicePlayer.setQueue((id) => {
        const list = delivered.current;
        const from = list.findIndex((m) => m.voice?.attachmentId === id);
        if (from < 0) return null;
        const next = list.slice(from + 1).find((m) => m.voice);
        return next?.voice ? voiceTrack(session, groupId, next.voice) : null;
      });
      return () => {
        voicePlayer.setQueue(null);
        voicePlayer.stop();
      };
    }, [session, groupId]),
  );

  /**
   * The phone's copy of the history (SPEC §5.2): shown first, readable
   * offline. Best effort: it only serves offline reading, the server keeps
   * the history (and the store refuses writes once the app is locked).
   */
  const keep = useCallback((fn: (l: LocalStore) => Promise<unknown>) => fn(session.local).catch(() => {}), [session]);

  /** `replace`: the whole history was fetched again (after an erase), drop what is no longer in it. */
  const merge = useCallback((incoming: ChatMessage[], replace = false) => {
    if (!incoming.length && !replace) return;
    lastSeq.current = Math.max(lastSeq.current, ...incoming.map((m) => m.seq));
    setMessages((prev) => {
      const byId = new Map((replace ? [] : prev).map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
    const done = new Set(incoming.map((m) => m.clientId));
    setPending((p) => p.filter((x) => !done.has(x.clientId)));
  }, []);

  // What the phone kept, loaded once before the first fetch (which then only asks for what is newer).
  const localLoaded = useRef<Promise<void> | null>(null);
  // The outbox is saved on every change, but only once loaded: never overwritten by the empty start.
  const outboxLoaded = useRef(false);
  const loadLocal = useCallback(() => {
    localLoaded.current ??= (async () => {
      await keep(async (l) => {
        const queued = await loadOutbox(l, groupId);
        // Messages written meanwhile stay after those from before.
        setPending((p) => [...queued.filter((q) => !p.some((x) => x.clientId === q.clientId)), ...p]);
        outboxLoaded.current = true;
      });
      await keep(async (l) => {
        const [wire, chat] = await Promise.all([l.messages(groupId), l.getRecord<{ purgeSeq: number }>(records.chat(groupId))]);
        if (chat) purgeSeq.current = chat.purgeSeq;
        if (!wire.length) return;
        merge(await decrypt(wire));
        setLoaded(true);
      });
    })();
    return localLoaded.current;
  }, [keep, groupId, decrypt, merge]);

  /** New messages since the last fetch; the whole history again if part of it was erased meanwhile. */
  const resync = useCallback(
    async (opts: { full?: boolean } = {}) => {
      await loadLocal();
      try {
        let full = !!opts.full;
        let res = await fetchSince(session, groupId, full ? 0 : lastSeq.current);
        if (!full && purgeSeq.current !== null && res.purgeSeq > purgeSeq.current) {
          full = true;
          res = await fetchSince(session, groupId, 0);
        }
        purgeSeq.current = res.purgeSeq;
        merge(await decrypt(res.messages), full);
        setLoaded(true);
        setOnline(true);
        setFlushes((n) => n + 1);
        void keep(async (l) => {
          await (full ? l.replaceMessages(groupId, res.messages) : l.saveMessages(groupId, res.messages));
          await l.setRecord(records.chat(groupId), { purgeSeq: res.purgeSeq });
        });
      } catch (e) {
        if (e instanceof NetworkError) {
          setOnline(false);
          setLoaded(true);
        }
      }
    },
    [session, groupId, decrypt, merge, keep, loadLocal],
  );

  useEffect(() => {
    void resync();
    const rt = new RealtimeClient(API_URL, () => session.api.accessToken(), {
      onConnected: () => void resync(),
      onStatus: setOnline,
      onPurge: (id) => {
        if (id === groupId) void resync({ full: true });
      },
      onMessage: (m) => {
        if (m.groupId !== groupId) return;
        void keep((l) => l.saveMessages(groupId, [m]));
        decrypt([m])
          .then(merge)
          .catch(() => void resync());
      },
    });
    rt.start();
    return () => rt.stop();
  }, [session, groupId, resync, decrypt, merge, keep]);

  /** Self-destructed: keys out of memory and off the phone, nothing left to show. */
  const destroy = useCallback(() => {
    const open = openGroups.get(groupId);
    if (open) for (const k of open.keys.values()) wipe(k);
    openGroups.delete(groupId);
    void forgetGroup(session, groupId, current.current.keyVersion);
    setMessages([]);
    setPending([]);
    setDestroyed(true);
  }, [openGroups, groupId, session]);

  // Countdown refresh, and the end of the group when its date comes.
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const t = new Date();
      setNow(t);
      if (t >= expiresAt) destroy();
    };
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [expiresAt, destroy]);

  function confirmErase(day: Date, days: number) {
    const { from } = dayRange(day, days);
    const today = new Date();
    const span =
      days === 1
        ? `du ${dayLabel(day, today).toLowerCase()}`
        : `du ${dayLabel(from, today).toLowerCase()} au ${dayLabel(day, today).toLowerCase()}`;
    Alert.alert(`Effacer les messages ${span} ?`, 'Les messages, les photos et les vocaux de cette période seront effacés pour tous les membres. C’est définitif.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Effacer',
        style: 'destructive',
        onPress: () => void erase(day, days),
      },
    ]);
  }

  async function erase(day: Date, days: number) {
    const { from, to } = dayRange(day, days);
    try {
      await session.api.eraseMessages(groupId, from, to);
      await resync({ full: true });
    } catch (e) {
      Alert.alert(
        'Impossible d’effacer',
        e instanceof NetworkError
          ? 'Pas de réseau.'
          : e instanceof ApiError && e.code === 'admin_only'
            ? 'Seul un admin peut effacer des messages.'
            : 'Réessaie plus tard.',
      );
    }
  }

  useEffect(() => {
    if (outboxLoaded.current) void keep((l) => saveOutbox(l, groupId, pending));
  }, [pending, keep, groupId]);

  // Network back (or group opened): what waits goes out, in order.
  const [flushes, setFlushes] = useState(0);
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    if (!flushes) return;
    const queue = pending.filter((p) => !p.error && !inFlight.current.has(p.clientId));
    void (async () => {
      for (const p of queue) await send(p, { scroll: false });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per flush, with the queue of that moment
  }, [flushes]);

  async function send(item: Pending, { scroll = true } = {}) {
    const { clientId } = item;
    if (inFlight.current.has(clientId)) return;
    inFlight.current.add(clientId);
    if (scroll) list.current?.scrollToOffset({ offset: 0, animated: true });
    setPending((p) =>
      p.some((x) => x.clientId === clientId)
        ? p.map((x) => (x.clientId === clientId ? { ...item, failed: false, error: undefined } : x))
        : [...p, { ...item, failed: false, error: undefined }],
    );
    try {
      let ready = item;
      // Encrypted on the phone with a fresh file key, then uploaded: the server only stores the blob.
      if (ready.kind === 'image' && !ready.body) {
        const body = await uploadImage(session, groupId, ready.image);
        ready = { ...ready, body };
        setPending((p) => p.map((x) => (x.clientId === clientId && x.kind === 'image' ? { ...x, body } : x)));
      }
      if (ready.kind === 'voice' && !ready.body) {
        const body = await uploadVoice(session, groupId, ready.voice);
        ready = { ...ready, body };
        setPending((p) => p.map((x) => (x.clientId === clientId && x.kind === 'voice' ? { ...x, body } : x)));
      }
      const attempt = (g: OpenGroup) =>
        ready.kind === 'text'
          ? sendText(session, groupId, g.keys.get(g.keyVersion)!, g.keyVersion, ready.text, clientId, ready.replyTo)
          : sendAttachment(session, groupId, g.keys.get(g.keyVersion)!, g.keyVersion, { ...ready.body!, ...(ready.replyTo && { replyTo: ready.replyTo }) }, clientId);
      let wire: WireMessage;
      try {
        wire = await attempt(current.current);
      } catch (e) {
        // The key was rotated since we opened the group: pick up the new one, send again.
        if (!(e instanceof ApiError && e.code === 'stale_key_version')) throw e;
        wire = await attempt(await sync());
      }
      // Our own image or voice message: no need to download what we just sent.
      if (ready.kind === 'image') imageCache.set(ready.body!.attachmentId, ready.image.jpeg);
      if (ready.kind === 'voice') voiceCache.set(ready.body!.attachmentId, ready.voice.audio);
      void keep((l) => l.saveMessages(groupId, [wire]));
      merge(await decrypt([wire]));
    } catch (e) {
      // Same clientId on retry: the server de-duplicates if the first send did land.
      // No network: stays waiting (⏳) and goes out when the connection is back.
      const error = e instanceof AttachmentTooLargeError ? (item.kind === 'voice' ? 'Vocal trop long' : 'Image trop lourde') : undefined;
      const failed = !(e instanceof NetworkError);
      setPending((p) => p.map((x) => (x.clientId === clientId ? { ...x, failed, error } : x)));
    } finally {
      inFlight.current.delete(clientId);
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

  const recorder = useVoiceRecorder((voice) => {
    void send({ clientId: newClientId(), at: new Date().toISOString(), kind: 'voice', voice, failed: false, replyTo: takeReply() });
  });

  async function startVoice() {
    const res = await recorder.start();
    if (res === 'denied') {
      Alert.alert('Micro désactivé', 'Autorise l’accès au micro dans les réglages du téléphone pour envoyer des vocaux.');
    } else if (res === 'failed') {
      Alert.alert('Impossible d’enregistrer', 'Le micro n’a pas pu démarrer. Réessaie.');
    }
  }

  if (destroyed) return <GroupGone />;

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
      {expiresAt ? (
        <View style={styles.banner}>
          <Led state="red" size={7} />
          <Text style={styles.bannerText} numberOfLines={1}>
            AUTODESTRUCTION {countdownLabel(expiresAt, now).toUpperCase()} — {dateTimeLabel(expiresAt, now).toUpperCase()}
          </Text>
        </View>
      ) : null}
      {alert ? (
        <View style={[styles.banner, styles.alertBanner]}>
          <Led state="red" size={7} />
          <Text style={styles.bannerText}>{alert.toUpperCase()}</Text>
        </View>
      ) : null}
      {newAdmin ? (
        <Pressable style={styles.banner} onPress={() => setNewAdmin(false)} accessibilityRole="button">
          <Led state="amber" size={7} />
          <Text style={styles.bannerText}>LES ADMINS DU GROUPE ONT CHANGÉ — VOIR LES RÉGLAGES</Text>
        </Pressable>
      ) : null}
      {requests.length ? (
        <Pressable style={styles.banner} onPress={() => setReviewing(true)} accessibilityRole="button">
          <Led state="amber" size={7} />
          <Text style={styles.bannerText}>
            {requests.length === 1 ? '1 DEMANDE D’ACCÈS — APPUIE POUR VOIR' : `${requests.length} DEMANDES D’ACCÈS — APPUIE POUR VOIR`}
          </Text>
        </Pressable>
      ) : null}
      <Modal visible={reviewing && requests.length > 0} transparent animationType="fade" onRequestClose={() => setReviewing(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <Text style={type.heading}>Demandes d’accès</Text>
            <Text style={type.dim}>
              Ces personnes ont donné le bon code et les bons mots-clés. Accepter leur envoie la clé du groupe. Pour être sûr que c’est bien elles,
              compare en vrai ce numéro de sécurité avec celui affiché sur leur téléphone (Réglages) : les chiffres doivent être identiques.
            </Text>
            {requests.map((r) => (
              <View key={r.userId} style={styles.request}>
                <Text style={styles.requestName}>{r.username}</Text>
                {r.keyChanged ? (
                  <Text style={styles.requestWarning}>Ses clés ont changé depuis la dernière fois : ne l’accepte pas sans vérifier.</Text>
                ) : (
                  <Text style={styles.safety} selectable>
                    {r.fingerprint}
                  </Text>
                )}
                <View style={styles.requestButtons}>
                  <Pressable style={[styles.requestButton, styles.reject]} onPress={() => void decide(r, false)} accessibilityRole="button">
                    <Text style={styles.requestButtonText}>Refuser</Text>
                  </Pressable>
                  {!r.keyChanged ? (
                    <Pressable style={[styles.requestButton, styles.accept]} onPress={() => void decide(r, true)} accessibilityRole="button">
                      <Text style={styles.requestButtonText}>Accepter</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
            <Pressable onPress={() => setReviewing(false)} accessibilityRole="button" style={styles.sheetClose}>
              <Text style={type.dim}>Fermer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
            ) : item.voice ? (
              <SentVoice session={session} groupId={groupId} body={item.voice} />
            ) : item.localVoice ? (
              <VoiceBubble
                track={{ id: item.key, durationMs: item.localVoice.durationMs, load: () => Promise.resolve(item.localVoice!.audio) }}
                waveform={item.localVoice.waveform}
              />
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
          onDayLongPress={
            role === 'admin'
              ? (day) => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setEraseDay(day);
                }
              : undefined
          }
        />
        <Composer
          value={draft}
          onChange={setDraft}
          attaching={picking}
          onAttach={() => void sendPhoto()}
          replyTo={replying ? resolveQuote(replyRefFor(replying)!, messages, session.account.userId) : null}
          onCancelReply={() => setReplying(null)}
          inputRef={input}
          voice={{
            phase: recorder.phase,
            elapsedMs: recorder.elapsedMs,
            levels: recorder.levels,
            onStart: () => void startVoice(),
            onCancel: () => void recorder.cancel(),
            onSend: () => void recorder.finish(),
          }}
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
      <ActionSheet visible={eraseDay !== null} onClose={() => setEraseDay(null)}>
        <Text style={styles.sheetTitle}>EFFACER POUR TOUS · {eraseDay ? dayLabel(eraseDay, now) : ''}</Text>
        {ERASE_SPANS.map((span) => (
          <ActionKey
            key={span.days}
            label={span.label}
            danger
            onPress={() => {
              const day = eraseDay!;
              setEraseDay(null);
              confirmErase(day, span.days);
            }}
          />
        ))}
        <ActionKey label="Annuler" dim onPress={() => setEraseDay(null)} />
      </ActionSheet>
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
  voice?: VoiceBody;
  localVoice?: PreparedVoice;
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
  onDayLongPress,
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
  /** Long press on a day separator (admins: erase menu). */
  onDayLongPress?(day: Date): void;
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
        voice: m.voice ?? undefined,
        status: m.mine ? ('sent' as const) : undefined,
        replyTo: m.replyTo ?? undefined,
        // Unreadable messages cannot be quoted.
        message: m.text !== null || m.image || m.voice ? m : undefined,
      })),
      ...pending.map((p) => ({
        key: p.clientId,
        senderId: me,
        at: new Date(p.at),
        mine: true,
        author: '',
        text: p.kind === 'text' ? p.text : null,
        local: p.kind === 'image' ? p.image : undefined,
        localVoice: p.kind === 'voice' ? p.voice : undefined,
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
            Les messages, les photos et les vocaux sont chiffrés sur ton téléphone. Seuls les membres du groupe peuvent les lire.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        if (item.kind === 'day') {
          return <DaySeparator label={item.label} onLongPress={onDayLongPress ? () => onDayLongPress(item.at) : undefined} />;
        }
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
  alertBanner: { borderBottomColor: colors.danger },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: space.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: 12, padding: space.lg, gap: space.md, borderWidth: 1, borderColor: colors.border },
  sheetClose: { alignSelf: 'center', padding: space.sm },
  request: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  requestName: { ...type.heading, fontSize: 17 },
  requestWarning: { color: colors.danger },
  safety: { fontFamily: mono, fontSize: 15, letterSpacing: 1, color: colors.text, lineHeight: 22 },
  requestButtons: { flexDirection: 'row', gap: space.sm },
  requestButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  accept: { backgroundColor: colors.forest },
  reject: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  requestButtonText: { color: colors.text, fontFamily: fonts.semibold },
  timeline: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 3, flexGrow: 1 },
  runEnd: { marginBottom: space.sm },
  text: { color: colors.text, fontSize: 16, lineHeight: 21 },
  unreadable: { color: colors.textDim, fontStyle: 'italic', fontSize: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  emptyIcon: { fontSize: 32 },
  emptyTitle: { color: colors.text, fontSize: 18, fontFamily: fonts.semibold },
  sheetTitle: { fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: colors.textDim, textAlign: 'center', marginBottom: space.xs },
});
