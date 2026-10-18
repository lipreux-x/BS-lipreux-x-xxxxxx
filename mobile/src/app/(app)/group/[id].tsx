import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '@/config';
import { useUnlocked, type OpenGroup } from '@/session/SessionProvider';
import { ApiError, NetworkError, type WireMessage } from '@/services/api';
import {
  decryptMessages,
  fetchSince,
  listGroups,
  newClientId,
  sendText,
  shareMissingKeys,
  syncGroup,
  unlockGroup,
  type ChatMessage,
  type GroupLockState,
} from '@/services/groups';
import { RealtimeClient } from '@/services/realtime';
import { LockedOutError, WrongCodeError } from '@/services/vault';
import { CodeEntry } from '@/ui/CodeEntry';
import { colors, space, type } from '@/ui/theme';

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

  useEffect(() => {
    void listGroups(session)
      .then((gs) => setState(gs.find((g) => g.id === groupId)?.state ?? { kind: 'waiting-key' }))
      .catch(() => setState({ kind: 'locked' }));
  }, [session, groupId]);

  async function attempt(code: string): Promise<string | null> {
    try {
      const res = await unlockGroup(session, groupId, code);
      if (!res) {
        setState({ kind: 'waiting-key' });
        return null;
      }
      onOpen({ keys: res.keys, keyVersion: res.keyVersion, name: res.meta.name });
      return null;
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

interface Pending {
  clientId: string;
  text: string;
  failed: boolean;
}

function Chat({ groupId, group, onUpdate }: { groupId: string; group: OpenGroup; onUpdate(g: OpenGroup): void }) {
  const { session, profiles } = useUnlocked();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [online, setOnline] = useState(true);
  const [removed, setRemoved] = useState(false);
  const lastSeq = useRef(0);
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
        void decrypt([m]).then(merge);
      },
    });
    rt.start();
    return () => rt.stop();
  }, [session, groupId, resync, decrypt, merge]);

  async function send(text: string, clientId = newClientId()) {
    setPending((p) => [...p.filter((x) => x.clientId !== clientId), { clientId, text, failed: false }]);
    const attempt = (g: OpenGroup) => sendText(session, groupId, g.keys.get(g.keyVersion)!, g.keyVersion, text, clientId);
    try {
      let wire: WireMessage;
      try {
        wire = await attempt(current.current);
      } catch (e) {
        // The key was rotated since we opened the group: pick up the new one, send again.
        if (!(e instanceof ApiError && e.code === 'stale_key_version')) throw e;
        wire = await attempt(await sync());
      }
      merge(await decrypt([wire]));
    } catch {
      // Same clientId on retry: the server de-duplicates if the first send did land.
      setPending((p) => p.map((x) => (x.clientId === clientId ? { ...x, failed: true } : x)));
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

  type Row = { key: string; mine: boolean; text: string | null; author?: string; status?: 'sending' | 'failed'; pending?: Pending };
  const rows: Row[] = [
    ...messages.map((m) => ({ key: m.id, mine: m.mine, text: m.text, author: m.mine ? undefined : m.senderName })),
    ...pending.map((p) => ({ key: p.clientId, mine: true, text: p.text, status: p.failed ? ('failed' as const) : ('sending' as const), pending: p })),
  ].reverse();

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: group.name,
          headerRight: () => (
            <Pressable hitSlop={12} onPress={() => router.push({ pathname: '/group/settings', params: { id: groupId } })}>
              <Text style={{ color: colors.accentFg }}>Réglages</Text>
            </Pressable>
          ),
        }}
      />
      {!online ? <Text style={styles.banner}>Hors ligne — les messages partiront dès le retour du réseau</Text> : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ padding: space.md, gap: space.sm }}
          renderItem={({ item }) => (
            <Pressable
              disabled={item.status !== 'failed'}
              onPress={() => item.pending && void send(item.pending.text, item.pending.clientId)}
              style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}
            >
              {item.author ? <Text style={styles.author}>{item.author}</Text> : null}
              <Text style={item.text === null ? styles.unreadable : type.body}>{item.text ?? 'Message illisible (signature ou clé invalide)'}</Text>
              {item.status ? <Text style={styles.status}>{item.status === 'sending' ? '⏳' : 'Échec — touche pour renvoyer'}</Text> : null}
            </Pressable>
          )}
        />
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message chiffré"
            placeholderTextColor={colors.textDim}
            multiline
            maxLength={4000}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Envoyer"
            disabled={!draft.trim()}
            onPress={() => {
              const text = draft.trim();
              setDraft('');
              void send(text);
            }}
            style={[styles.send, !draft.trim() && { opacity: 0.4 }]}
          >
            <Text style={styles.sendLabel}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  banner: { backgroundColor: colors.surface2, color: colors.textDim, padding: space.sm, textAlign: 'center', fontSize: 13 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.forest, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface2, borderBottomLeftRadius: 4 },
  author: { color: colors.accentFg, fontSize: 12, marginBottom: 2 },
  unreadable: { color: colors.textDim, fontStyle: 'italic' },
  status: { color: colors.textDim, fontSize: 11, marginTop: 4, textAlign: 'right' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.accentFg, alignItems: 'center', justifyContent: 'center' },
  sendLabel: { color: colors.text, fontSize: 22, fontWeight: '700' },
});
