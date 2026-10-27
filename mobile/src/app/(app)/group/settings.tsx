import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LockKeyhole, MessageSquareLock } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { wipe } from '@/crypto/encoding';
import { useUnlocked } from '@/session/SessionProvider';
import { useInsideGroup } from '@/session/useInsideGroup';
import { ApiError, NetworkError } from '@/services/api';
import { groupInfo, leaveGroup, type GroupInfo, type GroupInfoMember } from '@/services/groupInfo';
import { CodeChangedError, fingerprintOf, GroupTamperedError, KeyChangedError, rotateNow, setAdmins } from '@/services/groups';
import { records } from '@/services/localStore';
import { LockedOutError, WrongCodeError } from '@/services/vault';
import { Avatar, isAvatarId } from '@/ui/avatars';
import { CHAT_LOOKS, chatLook, type ChatLook } from '@/ui/chat/look';
import { countdownLabel, dateTimeLabel } from '@/ui/chat/timeline';
import { CodeEntry } from '@/ui/CodeEntry';
import { useDialog } from '@/ui/Dialog';
import { Key } from '@/ui/Key';
import { Label } from '@/ui/Label';
import { panelStyle } from '@/ui/Panel';
import { screenStyle } from '@/ui/Screen';
import { Segment } from '@/ui/Segment';
import { Working } from '@/ui/Working';
import { colors, fonts, lcd, mono, neon, space, type } from '@/ui/theme';

const EPHEMERAL: { label: string; seconds: number | null }[] = [
  { label: 'Désactivés', seconds: null },
  { label: '24 h', seconds: 86_400 },
  { label: '7 jours', seconds: 604_800 },
];

/**
 * Group settings (SPEC §7): keywords, members (admin first), disappearing
 * messages, the look of the conversation on this phone, leave. Admins also remove members (the key is rotated right
 * away) and change the code. Only reachable from an open group.
 *
 * Each other member can be written to in private (a conversation of two,
 * group/direct). A private conversation's own sheet has no keywords, no code
 * to change and nobody to remove: the other person (their safety number),
 * the same settings, and « Supprimer la discussion », for both.
 */
export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profiles, openGroups } = useUnlocked();
  const insets = useSafeAreaInsets();
  useInsideGroup(id);
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, dialogView] = useDialog();
  // The keywords stay hidden until the group code is typed again (a phone left
  // unlocked in someone's hands should not give them away); shown until the
  // screen is left or « Masquer » is tapped.
  const [keywordsShown, setKeywordsShown] = useState<'hidden' | 'asking' | 'shown'>('hidden');
  const [lockedFor, setLockedFor] = useState(0);
  useEffect(() => () => setKeywordsShown('hidden'), []);
  // The look of the conversation: this phone's own choice, sealed in its local store (undefined: not read yet).
  const [look, setLook] = useState<ChatLook | undefined>(undefined);
  useEffect(() => {
    session.local
      .getRecord<{ look: unknown }>(records.look(id))
      .then((r) => setLook(chatLook(r?.look)))
      .catch(() => setLook('terminal'));
  }, [session, id]);
  function chooseLook(next: ChatLook) {
    setLook(next);
    session.local.setRecord(records.look(id), { look: next }).catch(() => {});
  }

  /** The group code against the key locked on this phone: a wrong one counts as an attempt, like at the door. */
  async function revealKeywords(code: string) {
    const open = openGroups.get(id);
    if (!open) return null;
    try {
      wipe(await session.vault.openGroupKey(id, open.keyVersion, code, session.masterKey));
      return () => setKeywordsShown('shown');
    } catch (e) {
      if (e instanceof WrongCodeError) return 'Code incorrect';
      if (e instanceof LockedOutError) {
        setLockedFor(e.retryInMs);
        return 'Trop d’essais, réessaie plus tard';
      }
      return 'Impossible de vérifier le code';
    }
  }

  const load = useCallback(() => {
    // Reached by a link while the group is locked: nothing is shown without its code.
    if (!openGroups.has(id)) {
      router.replace({ pathname: '/group/[id]', params: { id } });
      return;
    }
    groupInfo(session, profiles, id)
      .then((i) => {
        setInfo(i);
        setError(null);
      })
      .catch((e) => setError(message(e, 'Impossible de charger les réglages')));
  }, [session, profiles, openGroups, id]);
  // Also after changing the code: the keywords shown come from the refreshed meta.
  useFocusEffect(load);

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      dialog(failure, message(e, 'Réessaie plus tard.'));
    } finally {
      setBusy(false);
    }
  }

  function remove(m: GroupInfoMember) {
    dialog(
      `Retirer ${m.username} ?`,
      'Une nouvelle clé sera créée tout de suite : il ne pourra plus lire les nouveaux messages, ni revenir avec le code. Change aussi le code et les mots-clés s’il pourrait les avoir donnés à quelqu’un.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await session.api.removeMember(id, m.userId);
              // Rotate now, so the removed member never sees the next messages' key.
              const open = openGroups.get(id);
              if (open) {
                const r = await rotateNow(session, profiles, id, open.keys);
                openGroups.set(id, { keys: r.keys, keyVersion: r.keyVersion, name: r.name });
              }
              load();
            }, 'Impossible de retirer ce membre'),
        },
      ],
    );
  }

  /** A member's own key fingerprint, as this phone pinned it: compare it with the one on their phone. */
  async function showFingerprint(m: GroupInfoMember) {
    const f = await fingerprintOf(profiles, m.userId);
    if (!f) return;
    dialog(
      `Numéro de sécurité de ${m.username}`,
      f.keyChanged
        ? `Attention : ses clés ont changé depuis que ce téléphone les a vues. Ses nouveaux messages ne sont pas considérés comme les siens.\n\nNuméro connu :\n${f.fingerprint}`
        : `${f.fingerprint}\n\nCompare ces chiffres avec ceux affichés dans Réglages sur son téléphone (Mon numéro de sécurité). Identiques : c’est bien lui, personne n’a remplacé ses clés.`,
    );
  }

  /** A private conversation goes for both of us, with everything in it. */
  function deleteDirect(i: GroupInfo) {
    dialog(
      'Supprimer la discussion ?',
      `Elle sera effacée pour toi et pour ${i.name ?? 'l’autre'} : messages, photos, vocaux et clés. Impossible de revenir en arrière.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await leaveGroup(session, id, i.keyVersion);
              const open = openGroups.get(id);
              if (open) for (const k of open.keys.values()) wipe(k);
              openGroups.delete(id);
              router.dismissAll();
            }, 'Impossible de supprimer la discussion'),
        },
      ],
    );
  }

  function leave(i: GroupInfo) {
    const others = i.members.filter((m) => !m.me && !m.unknown);
    const lastAdmin = i.myRole === 'admin' && i.members.filter((m) => m.role === 'admin').length === 1 && others.length > 0;
    dialog(
      'Quitter le groupe ?',
      lastAdmin
        ? 'Tu es le seul admin : le membre le plus ancien le deviendra. Tu ne pourras revenir qu’avec le code, les mots-clés et l’accord d’un admin.'
        : 'Tu ne pourras revenir qu’avec le code, les mots-clés et l’accord d’un admin.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Quitter',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              if (lastAdmin) {
                // Signed by us while still admin: the other phones follow this, not the server.
                const open = openGroups.get(id);
                if (!open) throw new ApiError(409, 'not_open');
                const { members } = await session.api.members(id); // oldest first
                const next = members.find((m) => m.userId !== session.account.userId && others.some((o) => o.userId === m.userId));
                if (next) await setAdmins(session, profiles, id, open.keys, [next.userId]);
              }
              await leaveGroup(session, id, i.keyVersion);
              const open = openGroups.get(id);
              if (open) for (const k of open.keys.values()) wipe(k);
              openGroups.delete(id);
              router.dismissAll();
            }, 'Impossible de quitter le groupe'),
        },
      ],
    );
  }

  // Locks just this group: its keys leave memory, the code is asked again next time.
  function close() {
    const open = openGroups.get(id);
    if (open) for (const k of open.keys.values()) wipe(k);
    openGroups.delete(id);
    router.dismissAll();
  }

  if (!info) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.error}>{error}</Text> : <Working />}
      </View>
    );
  }

  const admin = info.myRole === 'admin';
  const direct = info.direct;
  // In a private conversation, only the other person is listed.
  const shown = direct ? info.members.filter((m) => !m.me) : info.members;
  return (
    // Edge to edge: "Quitter le groupe" stays above the navigation bar / home indicator.
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xl }]}>
      {info.name ? <Stack.Screen options={{ title: info.name }} /> : null}
      {dialogView}

      {direct ? null : (
        <>
        <Label style={styles.section}>Mots-clés pour rejoindre</Label>
        <View style={styles.card}>
          {keywordsShown === 'shown' ? (
            <>
              <View style={styles.keywords}>
                {(info.keywords ?? []).map((k, i) => (
                  <View key={i} style={styles.chip}>
                    <Text style={styles.chipText}>{k}</Text>
                  </View>
                ))}
              </View>
              <Key size="sm" tone="cold" label="Masquer" style={styles.reveal} onPress={() => setKeywordsShown('hidden')} />
              <Text style={[type.dim, styles.note]}>À donner en vrai avec le code, jamais par message.</Text>
            </>
          ) : keywordsShown === 'asking' ? (
            <>
              <CodeEntry title="Code du groupe" subtitle="Pour afficher les mots-clés." onComplete={revealKeywords} lockedForMs={lockedFor} />
              <Pressable accessibilityRole="button" onPress={() => setKeywordsShown('hidden')} hitSlop={8} style={styles.link}>
                <Text style={styles.linkText}>Annuler</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.keywords}>
                {(info.keywords ?? []).map((k, i) => (
                  <View key={i} style={[styles.chip, styles.chipHidden]}>
                    <Text style={[styles.chipText, styles.chipTextHidden]}>{'•'.repeat(Math.max(4, Math.min(8, k.length)))}</Text>
                  </View>
                ))}
              </View>
              <Key size="sm" tone="cold" label="Afficher · code du groupe" style={styles.reveal} disabled={!info.keywords} onPress={() => setKeywordsShown('asking')} />
              <Text style={[type.dim, styles.note]}>Masqués tant que le code du groupe n’est pas retapé. À donner en vrai avec le code, jamais par message.</Text>
            </>
          )}
        </View>
        </>
      )}

      <Label style={styles.section}>{direct ? 'Discussion privée' : `Membres · ${info.members.length}`}</Label>
      <View style={styles.card}>
        {shown.map((m, i) => (
          <View key={m.userId} style={[styles.row, i > 0 && styles.divider]}>
            <Avatar id={isAvatarId(m.avatar) ? m.avatar : null} size={36} />
            <Pressable style={{ flex: 1 }} disabled={m.me} onPress={() => void showFingerprint(m)} accessibilityRole="button">
              <Text style={type.body}>
                {m.username}
                {m.me ? <Text style={type.dim}> (toi)</Text> : null}
              </Text>
              {m.keyChanged ? <Text style={styles.danger}>Clés changées : à vérifier</Text> : null}
              {m.unknown ? <Text style={styles.danger}>Pas accepté par un admin : ne reçoit pas la clé</Text> : null}
              {!m.me && !m.keyChanged && !m.unknown ? <Text style={type.dim}>Voir son numéro de sécurité</Text> : null}
            </Pressable>
            {m.role === 'admin' && !direct ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Admin</Text>
              </View>
            ) : null}
            {!direct && !m.me && !m.unknown && !m.keyChanged ? (
              <Pressable
                hitSlop={8}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Écrire en privé à ${m.username}`}
                // The settings sheet gives way to the new conversation.
                onPress={() => router.replace({ pathname: '/group/direct', params: { peer: m.userId } })}
                style={styles.directBtn}
              >
                <MessageSquareLock size={20} color={colors.accentFg} strokeWidth={2} />
              </Pressable>
            ) : null}
            {admin && !m.me && !direct ? (
              <Pressable hitSlop={8} disabled={busy} onPress={() => remove(m)} style={styles.removeBtn}>
                <Text style={styles.danger}>Retirer</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      <Label style={styles.section}>Affichage de la discussion</Label>
      <View style={styles.card}>
        <Segment options={CHAT_LOOKS} value={look} onChange={chooseLook} />
        <Text style={[type.dim, styles.note]}>
          {look === 'plates'
            ? 'Chaque message sur sa plaque, avec l’avatar et le nom de qui l’a écrit.'
            : 'Chaque message comme une ligne de terminal, sans avatar.'}{' '}
          Sur ce téléphone seulement : ce choix reste chiffré ici, le serveur ne le voit pas.
        </Text>
      </View>

      <Label style={styles.section}>Messages éphémères</Label>
      <View style={styles.card}>
        <Segment
          options={EPHEMERAL.map((o) => ({ label: o.label, value: o.seconds }))}
          value={info.ephemeralSeconds}
          disabled={!admin || busy}
          onChange={(seconds) =>
            void run(async () => {
              await session.api.setEphemeral(id, seconds);
              load();
            }, 'Impossible de changer ce réglage')
          }
        />
        <Text style={[type.dim, styles.note]}>
          {admin ? 'Les nouveaux messages s’effaceront après ce délai.' : 'Seul un admin peut changer ce réglage.'}
        </Text>
      </View>

      {info.expiresAt ? (
        <>
          <Label style={styles.section}>Autodestruction</Label>
          <View style={styles.card}>
            <Text style={type.body}>
              {dateTimeLabel(new Date(info.expiresAt), new Date())} ({countdownLabel(new Date(info.expiresAt), new Date())})
            </Text>
            <Text style={[type.dim, styles.note]}>
              À cette date, le groupe, ses messages et ses photos sont effacés de partout, pour tous les membres.
            </Text>
          </View>
        </>
      ) : null}

      {admin ? (
        <>
          <Label style={styles.section}>Effacer des messages</Label>
          <View style={styles.card}>
            <Text style={type.dim}>
              Dans la conversation, appuie longuement sur une date pour effacer ce jour, ce jour et la veille, ou la semaine jusqu’à ce jour. Effacé pour tous les membres, photos comprises.
            </Text>
          </View>
        </>
      ) : null}

      <View style={[styles.card, styles.actions]}>
        <Pressable disabled={busy} onPress={close} style={[styles.action, styles.separator]}>
          <View style={styles.actionRow}>
            <LockKeyhole size={16} color={colors.accentFg} />
            <Text style={type.body}>Fermer le coffre</Text>
          </View>
          <Text style={type.dim}>Le code sera redemandé pour rouvrir la discussion.</Text>
        </Pressable>
        {admin && !direct ? (
          <Pressable
            disabled={busy}
            onPress={() => router.push({ pathname: '/group/code', params: { id } })}
            style={[styles.action, styles.separator]}
          >
            <Text style={type.body}>Changer le code et les mots-clés</Text>
          </Pressable>
        ) : null}
        <Pressable disabled={busy} onPress={() => (direct ? deleteDirect(info) : leave(info))} style={styles.action}>
          <Text style={styles.danger}>{direct ? 'Supprimer la discussion' : 'Quitter le groupe'}</Text>
          {direct ? <Text style={type.dim}>Pour vous deux, avec tout ce qu’elle contient.</Text> : null}
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color={colors.accentFg} style={{ marginTop: space.md }} /> : null}
    </ScrollView>
  );
}

function message(e: unknown, fallback: string): string {
  if (e instanceof NetworkError) return 'Pas de réseau';
  if (e instanceof KeyChangedError) return 'Les clés d’un membre ont changé : vérifie son numéro de sécurité avant.';
  if (e instanceof CodeChangedError) return 'Le code du groupe a changé : rouvre le groupe avec le nouveau code, puis réessaie.';
  if (e instanceof GroupTamperedError) return 'Le serveur liste quelqu’un qu’aucun admin n’a accepté : action bloquée par sécurité.';
  return fallback;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger },
  section: { marginTop: space.md },
  card: { ...panelStyle, padding: space.md },
  keywords: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // The keywords on the safe's screen: lit characters, dark while hidden.
  chip: { ...screenStyle, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: lcd.on, fontFamily: mono, fontSize: 16, letterSpacing: 1, ...neon.text(lcd.on, 6) },
  chipTextHidden: { color: lcd.off, textShadowRadius: 0 },
  chipHidden: {},
  reveal: { marginTop: space.md, alignSelf: 'flex-start' },
  link: { marginTop: space.sm, alignSelf: 'center', paddingVertical: space.sm, paddingHorizontal: space.md },
  linkText: { color: colors.textDim, fontSize: 15 },
  note: { marginTop: space.md, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  badge: { borderWidth: 1, borderColor: colors.accentFg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: colors.accentFg, fontSize: 12, fontFamily: fonts.semibold },
  removeBtn: { paddingLeft: space.sm },
  directBtn: { paddingHorizontal: space.xs },
  danger: { color: colors.danger, fontSize: 15 },
  actions: { marginTop: space.lg, paddingVertical: 0 },
  action: { paddingVertical: space.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
