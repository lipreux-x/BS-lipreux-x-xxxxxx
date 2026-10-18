import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { Button } from '@/ui/Button';
import { colors, space, type } from '@/ui/theme';

export default function Settings() {
  const { session, lock } = useUnlocked();
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
        <Text style={type.body}>{session.account.username}</Text>
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
  inviteBox: { gap: space.sm, paddingVertical: space.sm },
  invite: { color: colors.text, fontSize: 22, fontFamily: 'monospace', letterSpacing: 1, textAlign: 'center' },
  error: { color: colors.danger },
});
