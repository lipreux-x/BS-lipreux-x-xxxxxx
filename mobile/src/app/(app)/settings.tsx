import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { Avatar, isAvatarId, type AvatarId } from '@/ui/avatars';
import { AvatarPicker } from '@/ui/AvatarPicker';
import { Button } from '@/ui/Button';
import { colors, space, type } from '@/ui/theme';

export default function Settings() {
  const { session, profiles, lock } = useUnlocked();
  // undefined: not loaded yet (the server holds the choice, shared with group mates).
  const [avatar, setAvatar] = useState<AvatarId | null | undefined>(undefined);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    session.api
      .me()
      .then((me) => setAvatar(isAvatarId(me.avatar) ? me.avatar : null))
      .catch(() => setAvatarError('Avatar indisponible hors ligne.'));
  }, [session]);

  async function chooseAvatar(next: AvatarId | null) {
    const previous = avatar ?? null;
    setAvatar(next); // shown at once, put back if the server refuses
    setAvatarError(null);
    try {
      await session.api.setAvatar(next);
      profiles.setAvatar(session.account.userId, next);
    } catch (e) {
      setAvatar(previous);
      setAvatarError(e instanceof NetworkError ? 'Pas de réseau.' : 'Impossible de changer l’avatar.');
    }
  }
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createInvite() {
    setBusy(true);
    setError(null);
    try {
      setInvite(await session.api.createInvite());
    } catch (e) {
      setError(e instanceof NetworkError ? 'Pas de réseau.' : e instanceof ApiError ? `Erreur (${e.code})` : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Section title="Profil">
        <View style={styles.profile}>
          <Avatar id={avatar ?? null} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.heading}>{session.account.username}</Text>
            <Text style={type.dim}>Visible par les membres de tes groupes.</Text>
          </View>
        </View>
        <Text style={styles.subTitle}>Photo de profil</Text>
        <AvatarPicker value={avatar ?? null} onChange={(id) => void chooseAvatar(id)} disabled={avatar === undefined} />
        {avatarError ? <Text style={styles.error}>{avatarError}</Text> : null}
      </Section>

      <Section title="Inviter un pote">
        <Text style={type.dim}>Un code à usage unique, valable 7 jours. Donne-le en main propre.</Text>
        {invite ? (
          <View style={styles.inviteBox}>
            <Text selectable style={styles.invite}>
              {invite.code}
            </Text>
            <Button title="Copier" variant="ghost" onPress={() => void Clipboard.setStringAsync(invite.code)} />
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Créer une invitation" onPress={createInvite} busy={busy} />
      </Section>

      <Section title="Sécurité">
        <Text style={type.dim}>L’app se verrouille dès qu’elle passe en arrière-plan.</Text>
        <Button title="Verrouiller maintenant" variant="ghost" onPress={lock} />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space.md, gap: space.lg, backgroundColor: colors.bg },
  section: { gap: space.sm, padding: space.md, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { color: colors.accentFg, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  subTitle: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: space.sm },
  inviteBox: { gap: space.sm, paddingVertical: space.sm },
  invite: { color: colors.text, fontSize: 22, fontFamily: 'monospace', letterSpacing: 1, textAlign: 'center' },
  error: { color: colors.danger },
});
