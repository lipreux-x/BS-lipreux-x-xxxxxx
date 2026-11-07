import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList } from 'react-native';
import { API_URL } from '@/config';
import { ApiError, NetworkError, type WireMessage } from '@/services/api';
import type { OpenGroup } from '@/session/SessionProvider';
import {
  approveMember,
  AttachmentTooLargeError,
  CodeChangedError,
  decryptMessages,
  fetchSince,
  joinRequests,
  markOpened,
  rejectMember,
  sendAttachment,
  sendReaction,
  sendText,
  syncGroup,
  uploadDocument,
  uploadImage,
  uploadStory,
  uploadVoice,
  type ChatMessage,
  type JoinRequestInfo,
  type ProfileCache,
  type Session,
} from '@/services/groups';
import { imageCache } from '@/services/images';
import { records } from '@/services/localStore';
import { loadOutbox, saveOutbox, type Pending } from '@/services/outbox';
import { clearGroupNotification } from '@/services/push';
import { RealtimeClient } from '@/services/realtime';
import { voiceCache, voicePlayer } from '@/services/voice';
import type { DialogButton } from '../Dialog';
import { voiceTrack } from '../VoiceBubble';
import { securityMessage } from './GroupUnlock';
import type { Item } from './ChatTimeline';
import type { Keep } from './useKeep';

type DialogFn = (title: string, message?: string, buttons?: DialogButton[]) => void;

/**
 * The message core of a chat: the phone's copy of the history, the live sync
 * (rotation, admin changes, join requests) and the outbox (sending, retrying,
 * flushing when the network is back). Everything else about the screen (the
 * UI state, stories, reactions, moderation, colours, the ephemeral countdown)
 * lives in Chat and feeds on what this returns.
 */
export function useChat({
  session,
  profiles,
  groupId,
  group,
  onUpdate,
  onLocked,
  dialog,
  keep,
  list,
}: {
  session: Session;
  profiles: ProfileCache;
  groupId: string;
  group: OpenGroup;
  onUpdate(g: OpenGroup): void;
  onLocked(): void;
  dialog: DialogFn;
  keep: Keep;
  /** The timeline's list, owned by Chat; `send` scrolls it to the latest. */
  list: React.RefObject<FlatList<Item> | null>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  // The last fetch failed for another reason than the network (server error): said, with a retry.
  const [fetchFailed, setFetchFailed] = useState(false);
  const [removed, setRemoved] = useState(false);
  // From the server at each sync: only admins erase days; self-destruct date if any.
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  // History fetched once: until then an empty list means "loading", not "no messages".
  const [loaded, setLoaded] = useState(false);
  // The last message this phone had shown before the conversation opened (null: never opened
  // here): « nouveaux messages » goes above the next one. Read once, before this opening marks more.
  const [readMark, setReadMark] = useState<number | null>(null);
  const lastSeq = useRef(0);
  // Latest keys for callbacks that outlive a render (realtime, retries).
  const current = useRef(group);
  useEffect(() => {
    current.current = group;
  }, [group]);

  // Admin: people waiting to be let in (the sheet is open while `reviewing` is set).
  const [requests, setRequests] = useState<JoinRequestInfo[]>([]);
  const [reviewing, setReviewing] = useState(false);
  // The last one answered: the sheet is closed for good, a later request does not pop it up over the chat.
  if (reviewing && !requests.length) setReviewing(false);
  // What the server sent did not check out (keys refused): shown, never silently used.
  const [alert, setAlert] = useState<string | null>(null);
  const [newAdmin, setNewAdmin] = useState(false);
  // Someone left with the current key: the server takes no message until a new one is drawn (an admin's phone).
  const [rotationWait, setRotationWait] = useState(false);

  /** Rotation if a member left (admin), keys rotated by an admin, join requests (admin). */
  const sync = useCallback(async (): Promise<OpenGroup> => {
    try {
      const r = await syncGroup(session, profiles, groupId, current.current.keys);
      const admin = r.meta.admins.includes(session.account.userId);
      setRole(admin ? 'admin' : 'member');
      setExpiresAt(r.summary.expiresAt ? new Date(r.summary.expiresAt) : null);
      if (r.adminChanged) setNewAdmin(true);
      setRotationWait(r.summary.rotationPending);
      setAlert(null);
      const g = { keys: r.keys, keyVersion: r.keyVersion, name: r.name, direct: !!r.meta.direct, link: !!r.meta.link };
      current.current = g;
      onUpdate(g);
      setRequests(admin ? await joinRequests(session, profiles, groupId).catch(() => []) : []);
      return g;
    } catch (e) {
      if (e instanceof CodeChangedError) onLocked();
      if (e instanceof ApiError && e.status === 404) setRemoved(true);
      const message = securityMessage(e);
      if (message) setAlert(message);
      return current.current;
    }
  }, [session, profiles, groupId, onUpdate, onLocked]);

  async function decide(r: JoinRequestInfo, accept: boolean) {
    try {
      if (accept) await approveMember(session, profiles, groupId, current.current.keys, r.userId);
      else await rejectMember(session, groupId, r.userId);
      setRequests((list) => list.filter((x) => x.userId !== r.userId));
      void sync();
    } catch (e) {
      if (e instanceof CodeChangedError) {
        // Its key would be wrapped under the old code: the new one first, then accept.
        setReviewing(false);
        dialog('Le code du groupe a changé', 'Rouvre le groupe avec le nouveau code, puis accepte la demande.', [{ text: 'OK', onPress: onLocked }]);
        return;
      }
      dialog(
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

  // On open and when coming back from the group's settings. The conversation
  // is on screen: its notification goes, and the group climbs the list.
  useFocusEffect(
    useCallback(() => {
      void sync();
      void markOpened(session, groupId, lastSeq.current);
      void clearGroupNotification(groupId);
    }, [sync, session, groupId]),
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

  /** `replace`: the whole history was fetched again (after an erase), drop what is no longer in it. */
  const merge = useCallback(
    (incoming: ChatMessage[], replace = false) => {
      if (!incoming.length && !replace) return;
      lastSeq.current = Math.max(lastSeq.current, ...incoming.map((m) => m.seq));
      // Shown here: nothing up to there waits in the list any more.
      void markOpened(session, groupId, lastSeq.current);
      setMessages((prev) => {
        const byId = new Map((replace ? [] : prev).map((m) => [m.id, m]));
        for (const m of incoming) byId.set(m.id, m);
        return [...byId.values()].sort((a, b) => a.seq - b.seq);
      });
      const done = new Set(incoming.map((m) => m.clientId));
      setPending((p) => p.filter((x) => !done.has(x.clientId)));
    },
    [session, groupId],
  );

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
        const [wire, chat, seen] = await Promise.all([
          l.messages(groupId),
          l.getRecord<{ purgeSeq: number }>(records.chat(groupId)),
          l.getRecord<{ seq: number }>(records.seen(groupId)),
        ]);
        if (chat) purgeSeq.current = chat.purgeSeq;
        if (seen?.seq) setReadMark(seen.seq);
        if (!wire.length) return;
        merge(await decrypt(wire));
        setLoaded(true);
      });
    })();
    return localLoaded.current;
  }, [keep, groupId, decrypt, merge]);

  // Latest erase of the history we have seen; null until the first fetch.
  const purgeSeq = useRef<number | null>(null);

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
        setFetchFailed(false);
        setFlushes((n) => n + 1);
        void keep(async (l) => {
          await (full ? l.replaceMessages(groupId, res.messages) : l.saveMessages(groupId, res.messages));
          await l.setRecord(records.chat(groupId), { purgeSeq: res.purgeSeq });
        });
      } catch (e) {
        // Whatever went wrong, the wait ends: what the phone kept shows, the banner says why nothing newer.
        setLoaded(true);
        if (e instanceof NetworkError) setOnline(false);
        else setFetchFailed(true);
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
      if (ready.kind === 'story' && !ready.body) {
        const body = await uploadStory(session, groupId, ready.image);
        ready = { ...ready, body };
        setPending((p) => p.map((x) => (x.clientId === clientId && x.kind === 'story' ? { ...x, body } : x)));
      }
      if (ready.kind === 'file' && !ready.body) {
        const body = await uploadDocument(session, groupId, ready.file);
        ready = { ...ready, body };
        setPending((p) => p.map((x) => (x.clientId === clientId && x.kind === 'file' ? { ...x, body } : x)));
      }
      const attempt = (g: OpenGroup) =>
        ready.kind === 'text'
          ? sendText(session, groupId, g.keys.get(g.keyVersion)!, g.keyVersion, ready.text, clientId, ready.replyTo)
          : ready.kind === 'reaction'
            ? sendReaction(session, groupId, g.keys.get(g.keyVersion)!, g.keyVersion, ready.reaction, clientId)
            : sendAttachment(session, groupId, g.keys.get(g.keyVersion)!, g.keyVersion, { ...ready.body!, ...(ready.replyTo && { replyTo: ready.replyTo }) }, clientId);
      let wire: WireMessage;
      try {
        wire = await attempt(current.current);
      } catch (e) {
        // The key was rotated since we opened the group: pick up the new one, send again.
        if (!(e instanceof ApiError && e.code === 'stale_key_version')) throw e;
        wire = await attempt(await sync());
      }
      // Our own image, story or voice message: no need to download what we just sent.
      if (ready.kind === 'image' || ready.kind === 'story') imageCache.set(ready.body!.attachmentId, ready.image.jpeg);
      if (ready.kind === 'voice') voiceCache.set(ready.body!.attachmentId, ready.voice.audio);
      void keep((l) => l.saveMessages(groupId, [wire]));
      merge(await decrypt([wire]));
      setRotationWait(false);
    } catch (e) {
      // Waiting for the new key: like no network, it stays waiting (⏳) and goes out under the new key.
      if (e instanceof ApiError && e.code === 'rotation_pending') {
        setRotationWait(true);
        setPending((p) => p.map((x) => (x.clientId === clientId ? { ...x, failed: false } : x)));
        return;
      }
      // Same clientId on retry: the server de-duplicates if the first send did land.
      // No network: stays waiting (⏳) and goes out when the connection is back.
      const error = e instanceof AttachmentTooLargeError ? (item.kind === 'voice' ? 'Vocal trop long' : 'Image trop lourde') : undefined;
      const failed = !(e instanceof NetworkError);
      setPending((p) => p.map((x) => (x.clientId === clientId ? { ...x, failed, error } : x)));
    } finally {
      inFlight.current.delete(clientId);
    }
  }

  // What the list gets keeps one identity across renders, so that its rows
  // (memoized) re-render only when they change. Retry calls the latest `send`.
  const sendLatest = useRef(send);
  useEffect(() => {
    sendLatest.current = send;
  });
  const retry = useCallback((p: Pending) => void sendLatest.current(p), []);
  // A stable sender for the UI (composer, reactions, pickers): memoized rows keep their identity.
  const sendStable = useCallback((item: Pending, opts?: { scroll?: boolean }) => void sendLatest.current(item, opts), []);

  /** Self-destructed, or history cleared: drop every message and pending item. */
  const reset = useCallback(() => {
    setMessages([]);
    setPending([]);
  }, []);

  /** One of my messages (or stories), deleted for everyone once confirmed; the history is then fetched again without it. */
  const confirmDelete = useCallback(
    (m: ChatMessage) => {
      const unsend = async () => {
        await session.api.deleteMessage(groupId, m.id, !!m.story);
        await resync({ full: true });
      };
      dialog(
        m.story ? 'Supprimer ta story ?' : 'Supprimer ce message ?',
        m.story
          ? 'Elle disparaît pour tout le monde, du serveur comme des téléphones.'
          : 'Il est effacé pour tout le monde, du serveur comme des téléphones, avec sa photo ou son fichier. À sa place, chacun voit « message supprimé ».',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Supprimer',
            style: 'destructive',
            onPress: () => void unsend().catch(() => dialog('Suppression impossible', 'Vérifie ta connexion et réessaie.')),
          },
        ],
      );
    },
    [session, groupId, resync, dialog],
  );

  return {
    messages,
    pending,
    setPending,
    loaded,
    readMark,
    confirmDelete,
    online,
    fetchFailed,
    removed,
    role,
    expiresAt,
    alert,
    newAdmin,
    setNewAdmin,
    rotationWait,
    requests,
    reviewing,
    setReviewing,
    sync,
    resync,
    decide,
    send: sendStable,
    retry,
    reset,
    current,
  };
}
