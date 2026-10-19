import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { wipe } from '@/crypto/encoding';
import { useUnlocked } from '@/session/SessionProvider';
import { useInsideGroup } from '@/session/useInsideGroup';
import { ApiError, NetworkError } from '@/services/api';
import { groupInfo, leaveGroup, type GroupInfo, type GroupInfoMember } from '@/services/groupInfo';
import { fingerprintOf, GroupTamperedError, KeyChangedError, rotateNow, setAdmins } from '@/services/groups';
import { Avatar, isAvatarId } from '@/ui/avatars';
import { countdownLabel, dateTimeLabel } from '@/ui/chat/timeline';
import { colors, space, type } from '@/ui/theme';

const EPHEMERAL: { label: string; seconds: number | null }[] = [
  { label: 'Désactivés', seconds: null },
  { label: '24 h', seconds: 86_400 },
  { label: '7 jours', seconds: 604_800 },
];

/**
 * Group settings (SPEC §7): keywords, members (admin first), disappearing
 * messages, leave. Admins also remove members (the key is rotated right
 * away) and change the code. Only reachable from an open group.
 */
export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profiles, openGroups } = useUnlocked();
  useInsideGroup(id);
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      Alert.alert(failure, message(e, 'Réessaie plus tard.'));
    } finally {
      setBusy(false);
    }
  }

  function remove(m: GroupInfoMember) {
    Alert.alert(
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
                openGroups.set(id, { keys: r.keys, keyVersion: r.keyVersion, name: r.meta.name });
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
    Alert.alert(
      `Empreinte de ${m.username}`,
      f.keyChanged
        ? `Attention : ses clés ont changé depuis que ce téléphone les a vues. Ses nouveaux messages ne sont pas considérés comme les siens.\n\nEmpreinte connue :\n${f.fingerprint}`
        : `${f.fingerprint}\n\nCompare ces chiffres avec ceux affichés dans Réglages sur son téléphone. Identiques : c’est bien lui, personne n’a remplacé ses clés.`,
    );
  }

  function leave(i: GroupInfo) {
    const others = i.members.filter((m) => !m.me && !m.unknown);
    const lastAdmin = i.myRole === 'admin' && i.members.filter((m) => m.role === 'admin').length === 1 && others.length > 0;
    Alert.alert(
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
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accentFg} />}
      </View>
    );
  }

  const admin = info.myRole === 'admin';
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {info.name ? <Stack.Screen options={{ title: info.name }} /> : null}

      <Text style={styles.section}>Mots-clés pour rejoindre</Text>
      <View style={styles.card}>
        <View style={styles.keywords}>
          {(info.keywords ?? []).map((k, i) => (
            <View key={i} style={styles.chip}>
              <Text style={styles.chipText}>{k}</Text>
            </View>
          ))}
        </View>
        <Text style={[type.dim, styles.note]}>À donner en vrai avec le code, jamais par message.</Text>
      </View>

      <Text style={styles.section}>Membres · {info.members.length}</Text>
      <View style={styles.card}>
        {info.members.map((m, i) => (
          <View key={m.userId} style={[styles.row, i > 0 && styles.divider]}>
            <Avatar id={isAvatarId(m.avatar) ? m.avatar : null} size={36} />
            <Pressable style={{ flex: 1 }} disabled={m.me} onPress={() => void showFingerprint(m)} accessibilityRole="button">
              <Text style={type.body}>
                {m.username}
                {m.me ? <Text style={type.dim}> (toi)</Text> : null}
              </Text>
              {m.keyChanged ? <Text style={styles.danger}>Clés changées : à vérifier</Text> : null}
              {m.unknown ? <Text style={styles.danger}>Pas accepté par un admin : ne reçoit pas la clé</Text> : null}
              {!m.me && !m.keyChanged && !m.unknown ? <Text style={type.dim}>Voir son empreinte</Text> : null}
            </Pressable>
            {m.role === 'admin' ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Admin</Text>
              </View>
            ) : null}
            {admin && !m.me ? (
              <Pressable hitSlop={8} disabled={busy} onPress={() => remove(m)} style={styles.removeBtn}>
                <Text style={styles.danger}>Retirer</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      <Text style={styles.section}>Messages éphémères</Text>
      <View style={styles.card}>
        <View style={styles.segment}>
          {EPHEMERAL.map((o) => {
            const on = info.ephemeralSeconds === o.seconds;
            return (
              <Pressable
                key={o.label}
                disabled={!admin || busy || on}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() =>
                  void run(async () => {
                    await session.api.setEphemeral(id, o.seconds);
                    load();
                  }, 'Impossible de changer ce réglage')
                }
                style={[styles.option, on && styles.optionOn]}
              >
                <Text style={[styles.optionText, on && styles.optionTextOn]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[type.dim, styles.note]}>
          {admin ? 'Les nouveaux messages s’effaceront après ce délai.' : 'Seul un admin peut changer ce réglage.'}
        </Text>
      </View>

      {info.expiresAt ? (
        <>
          <Text style={styles.section}>Autodestruction</Text>
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
          <Text style={styles.section}>Effacer des messages</Text>
          <View style={styles.card}>
            <Text style={type.dim}>
              Dans la conversation, appuie longuement sur une date pour effacer ce jour, ce jour et la veille, ou la semaine jusqu’à ce jour. Effacé pour tous les membres, photos comprises.
            </Text>
          </View>
        </>
      ) : null}

      <View style={[styles.card, styles.actions]}>
        <Pressable disabled={busy} onPress={close} style={[styles.action, styles.separator]}>
          <Text style={type.body}>🔒 Fermer le coffre</Text>
          <Text style={type.dim}>Le code sera redemandé pour rouvrir la discussion.</Text>
        </Pressable>
        {admin ? (
          <Pressable
            disabled={busy}
            onPress={() => router.push({ pathname: '/group/code', params: { id } })}
            style={[styles.action, styles.separator]}
          >
            <Text style={type.body}>Changer le code et les mots-clés</Text>
          </Pressable>
        ) : null}
        <Pressable disabled={busy} onPress={() => leave(info)} style={styles.action}>
          <Text style={styles.danger}>Quitter le groupe</Text>
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color={colors.accentFg} style={{ marginTop: space.md }} /> : null}
    </ScrollView>
  );
}

function message(e: unknown, fallback: string): string {
  if (e instanceof NetworkError) return 'Pas de réseau';
  if (e instanceof KeyChangedError) return 'Les clés d’un membre ont changé : vérifie son empreinte avant.';
  if (e instanceof GroupTamperedError) return 'Le serveur liste quelqu’un qu’aucun admin n’a accepté : action bloquée par sécurité.';
  return fallback;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger },
  section: { color: colors.textDim, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: space.md },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: space.md },
  keywords: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  note: { marginTop: space.md, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  badge: { borderWidth: 1, borderColor: colors.accentFg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: colors.accentFg, fontSize: 12, fontWeight: '600' },
  removeBtn: { paddingLeft: space.sm },
  danger: { color: colors.danger, fontSize: 15 },
  segment: { flexDirection: 'row', gap: space.sm },
  option: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  optionOn: { backgroundColor: colors.accent, borderColor: colors.accentFg },
  optionText: { color: colors.textDim, fontSize: 14 },
  optionTextOn: { color: colors.text, fontWeight: '600' },
  actions: { marginTop: space.lg, paddingVertical: 0 },
  action: { paddingVertical: space.md },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
