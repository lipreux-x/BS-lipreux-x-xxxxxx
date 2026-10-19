import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { keyFingerprint } from '@/crypto';
import { useUnlocked } from '@/session/SessionProvider';
import { copySensitive } from '@/services/clipboard';
import { ApiError, NetworkError } from '@/services/api';
import { WIPE_AFTER_CHOICES } from '@/services/vault';
import { Avatar, isAvatarId, type AvatarId } from '@/ui/avatars';
import { AvatarPicker } from '@/ui/AvatarPicker';
import { Button } from '@/ui/Button';
import { colors, space, type } from '@/ui/theme';

export default function Settings() {
  const { session, profiles, vault, lock, setScreenshotsBlocked } = useUnlocked();
  // Per-phone security options, read from the Secure Store (undefined until then).
  const [wipeAfter, setWipeAfter] = useState<number | null | undefined>(undefined);
  const [noScreenshots, setNoScreenshots] = useState<boolean | undefined>(undefined);
  const [bioOn, setBioOn] = useState<boolean | undefined>(undefined);
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    void vault.wipeAfter().then(setWipeAfter);
    void vault.screenshotsBlocked().then(setNoScreenshots);
    void vault.biometricsAvailable().then(setBioAvailable);
  }, [vault]);
  // Read again when coming back from the screen that turns biometrics on.
  useFocusEffect(
    useCallback(() => {
      void vault.biometricsEnabled().then(setBioOn);
    }, [vault]),
  );

  function chooseWipeAfter(next: number | null) {
    const save = () => void vault.setWipeAfter(next).then(() => setWipeAfter(next));
    if (next === null) return save();
    Alert.alert(
      `Tout effacer après ${next} codes faux ?`,
      'Clés, groupes et messages seront effacés de ce téléphone, sans retour possible. Tu pourras revenir avec « Se connecter » (pseudo + mot de passe), puis le code et les mots-clés de chaque groupe.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Activer', style: 'destructive', onPress: save },
      ],
    );
  }
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
        <Text style={type.dim}>Un code à usage unique, valable 2 heures. Donne-le en main propre.</Text>
        {invite ? (
          <View style={styles.inviteBox}>
            <Text selectable style={styles.invite}>
              {invite.code}
            </Text>
            <Button title="Copier" variant="ghost" onPress={() => void copySensitive(invite.code)} />
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Créer une invitation" onPress={createInvite} busy={busy} />
      </Section>

      <Section title="Mon empreinte">
        <Text style={styles.fingerprint} selectable>
          {keyFingerprint(session.identity)}
        </Text>
        <Text style={type.dim}>
          Pour rejoindre un groupe, montre ces chiffres à l’admin : il les compare avec ceux qu’il voit pour ta demande. S’ils sont identiques, personne
          n’a remplacé tes clés en chemin.
        </Text>
      </Section>

      <Section title="Sécurité">
        <Text style={type.dim}>
          Hors de l’app plus de 5 minutes, le code BaseSecrète est redemandé. Un groupe se referme 10 minutes après que tu l’as quitté.
        </Text>
        <Button title="Verrouiller maintenant" variant="ghost" onPress={lock} />

        <Text style={styles.subTitle}>Empreinte</Text>
        {bioAvailable || bioOn ? (
          <>
            <Text style={type.dim}>
              Ouvre l’app avec ton doigt au lieu du code. Le code reste demandé toutes les 48 h, et pour ouvrir chaque groupe. Si un doigt est
              ajouté au téléphone, l’empreinte se désactive.
            </Text>
            <Button
              title={bioOn ? 'Désactiver' : 'Activer'}
              variant={bioOn ? 'ghost' : 'primary'}
              disabled={bioOn === undefined}
              onPress={() => (bioOn ? void vault.disableBiometrics().then(() => setBioOn(false)) : router.push('/biometrics'))}
            />
          </>
        ) : (
          <Text style={type.dim}>Pas de capteur d’empreinte, ou aucun doigt enregistré sur ce téléphone.</Text>
        )}

        <Text style={styles.subTitle}>Captures d’écran</Text>
        <Text style={type.dim}>Bloquées : ni capture ni enregistrement de l’écran dans l’app, sur ce téléphone.</Text>
        <Segment
          options={[
            { label: 'Autorisées', value: false },
            { label: 'Bloquées', value: true },
          ]}
          value={noScreenshots}
          onChange={(blocked) => void setScreenshotsBlocked(blocked).then(() => setNoScreenshots(blocked))}
        />

        <Text style={styles.subTitle}>Auto-destruction</Text>
        <Text style={type.dim}>Après trop de codes faux d’affilée, tout ce que l’app garde sur ce téléphone est effacé.</Text>
        <Segment
          options={[{ label: 'Désactivée', value: null }, ...WIPE_AFTER_CHOICES.map((n) => ({ label: `${n} essais`, value: n }))]}
          value={wipeAfter}
          onChange={chooseWipeAfter}
        />
      </Section>
    </ScrollView>
  );
}

/** A row of choices; `value` undefined: not loaded yet (disabled). */
function Segment<T>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T | undefined; onChange(v: T): void }) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.label}
            disabled={value === undefined || on}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.option, on && styles.optionOn]}
          >
            <Text style={[styles.optionText, on && styles.optionTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
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
  segment: { flexDirection: 'row', gap: space.sm },
  option: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  optionOn: { backgroundColor: colors.accent, borderColor: colors.accentFg },
  optionText: { color: colors.textDim, fontSize: 14 },
  optionTextOn: { color: colors.text, fontWeight: '600' },
  fingerprint: { color: colors.text, fontSize: 18, fontFamily: 'monospace', letterSpacing: 1, textAlign: 'center', lineHeight: 28 },
});
