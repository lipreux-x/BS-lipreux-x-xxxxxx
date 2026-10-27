import { router, useFocusEffect } from 'expo-router';
import { Bell, Bomb, CameraOff, FingerprintPattern, Lock, ScanFace, ShieldCheck, type LucideIcon, User, UserPlus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keyFingerprint } from '@/crypto';
import { useUnlocked } from '@/session/SessionProvider';
import { copySensitive } from '@/services/clipboard';
import { ApiError, NetworkError } from '@/services/api';
import { biometricKind, biometricName, biometricWord, type BiometricKind } from '@/services/biometrics';
import { registerPush, type PushStatus } from '@/services/push';
import { WIPE_AFTER_CHOICES } from '@/services/vault';
import { Avatar, isAvatarId, type AvatarId } from '@/ui/avatars';
import { AvatarPicker } from '@/ui/AvatarPicker';
import { Button } from '@/ui/Button';
import { timeLabel } from '@/ui/chat/timeline';
import { useDialog } from '@/ui/Dialog';
import { InviteCodeDisplay } from '@/ui/InviteCode';
import { Panel } from '@/ui/Panel';
import { Screen } from '@/ui/Screen';
import { Segment } from '@/ui/Segment';
import { colors, fonts, lcd, mono, neon, space, type } from '@/ui/theme';

export default function Settings() {
  const { session, profiles, vault, lock, setScreenshotsBlocked } = useUnlocked();
  const insets = useSafeAreaInsets();
  const [dialog, dialogView] = useDialog();
  // Per-phone security options, read from the Secure Store (undefined until then).
  const [wipeAfter, setWipeAfter] = useState<number | null | undefined>(undefined);
  const [noScreenshots, setNoScreenshots] = useState<boolean | undefined>(undefined);
  const [bioOn, setBioOn] = useState<boolean | undefined>(undefined);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioKind, setBioKind] = useState<BiometricKind | null>(null);
  const [push, setPush] = useState<PushStatus | undefined>(undefined);

  // Read again when coming back from the phone's settings.
  useEffect(() => {
    const read = () => void registerPush(session.api, { ask: false }).then(setPush);
    read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => sub.remove();
  }, [session]);

  useEffect(() => {
    void vault.wipeAfter().then(setWipeAfter);
    void vault.screenshotsBlocked().then(setNoScreenshots);
    void vault.biometricsAvailable().then(setBioAvailable);
    void biometricKind().then(setBioKind);
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
    dialog(
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
      setError(inviteError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Edge to edge: the last options stay above the navigation bar / home indicator.
    <ScrollView contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + space.md }]}>
      {dialogView}
      <Section title="Profil" icon={User}>
        <View style={styles.profile}>
          <Avatar id={avatar ?? null} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.heading}>{session.account.username}</Text>
            <Text style={type.dim}>Visible par les membres de tes groupes.</Text>
          </View>
        </View>
        <Text style={[styles.subTitle, styles.subTitleRow]}>Photo de profil</Text>
        <AvatarPicker value={avatar ?? null} onChange={(id) => void chooseAvatar(id)} disabled={avatar === undefined} />
        {avatarError ? <Text style={styles.error}>{avatarError}</Text> : null}
      </Section>

      <Section title="Inviter un pote" icon={UserPlus}>
        <Text style={type.dim}>Un code à usage unique, valable 2 heures. Donne-le en main propre.</Text>
        {invite ? (
          <View style={styles.inviteBox}>
            <InviteCodeDisplay code={invite.code} />
            <Text style={styles.inviteExpiry}>Valable jusqu’à {timeLabel(new Date(invite.expiresAt))}</Text>
            <Button title="Copier" variant="ghost" onPress={() => void copySensitive(invite.code)} />
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title={invite ? 'Nouvelle invitation' : 'Créer une invitation'} onPress={createInvite} busy={busy} />
      </Section>

      <Section title="Mon numéro de sécurité" icon={ShieldCheck}>
        <Screen style={styles.fingerprintScreen}>
          <Text style={styles.fingerprint} selectable>
            {keyFingerprint(session.identity)}
          </Text>
        </Screen>
        <Text style={type.dim}>
          Ta carte d’identité dans l’app. Quand tu demandes à entrer dans un groupe, l’admin voit ces chiffres sur son téléphone : montre-lui les
          tiens en vrai. Identiques : c’est bien toi, personne ne s’est fait passer pour toi.
        </Text>
      </Section>

      <Section title="Sécurité" icon={Lock}>
        <Text style={type.dim}>
          Hors de l’app plus de 5 minutes, le code BaseSecrète est redemandé. Un groupe se referme 10 minutes après que tu l’as quitté.
        </Text>
        <Button title="Verrouiller maintenant" variant="ghost" onPress={lock} />

        <SubTitle icon={bioKind === 'face' ? ScanFace : FingerprintPattern}>{biometricName(bioKind)}</SubTitle>
        {bioAvailable || bioOn ? (
          <>
            <Text style={type.dim}>
              Ouvre l’app avec {biometricWord(bioKind)} au lieu du code. Le code reste demandé toutes les 48 h, et pour ouvrir chaque groupe. Si une
              empreinte ou un visage est ajouté au téléphone, l’option se désactive.
              {Platform.OS === 'android' && bioKind === 'both'
                ? ' Android n’accepte que ses biométries fortes : l’empreinte toujours, le visage seulement sur les téléphones où il l’est.'
                : ''}
            </Text>
            <Button
              title={bioOn ? 'Désactiver' : 'Activer'}
              variant={bioOn ? 'ghost' : 'primary'}
              disabled={bioOn === undefined}
              onPress={() => (bioOn ? void vault.disableBiometrics().then(() => setBioOn(false)) : router.push('/biometrics'))}
            />
          </>
        ) : (
          <Text style={type.dim}>Aucune empreinte ni visage enregistré sur ce téléphone, ou pas de capteur.</Text>
        )}

        <SubTitle icon={Bell}>Notifications</SubTitle>
        <Text style={type.dim}>
          {push === 'on'
            ? Platform.OS === 'android'
              ? 'Activées. Une notification par groupe, avec son nom (tel qu’il est sur ce téléphone) et « Nouveau message » ou ce que le groupe attend de toi : jamais le texte des messages, et jamais quand l’app est ouverte. Le serveur n’envoie que l’identifiant du groupe : le nom est ajouté par le téléphone. En la touchant, tu tapes tes codes, puis le groupe s’ouvre.'
              : 'Activées. Elles disent « Nouveau message » ou ce que le groupe attend de toi, sans nom de groupe ni texte, et jamais quand l’app est ouverte. En touchant la notification, tu tapes tes codes, puis le groupe s’ouvre.'
            : push === 'denied' || push === 'blocked'
              ? 'Refusées. Autorise les notifications de BaseSecrète dans les réglages du téléphone.'
              : push === 'unavailable'
                ? 'Indisponibles sur cette version de l’app.'
                : '…'}
        </Text>
        {push === 'denied' ? <Button title="Activer" variant="ghost" onPress={() => void registerPush(session.api).then(setPush)} /> : null}
        {push === 'blocked' ? <Button title="Ouvrir les réglages du téléphone" variant="ghost" onPress={() => void Linking.openSettings()} /> : null}

        <SubTitle icon={CameraOff}>Captures d’écran</SubTitle>
        <Text style={type.dim}>Bloquées : ni capture ni enregistrement de l’écran dans l’app, sur ce téléphone.</Text>
        <Segment
          options={[
            { label: 'Autorisées', value: false },
            { label: 'Bloquées', value: true },
          ]}
          value={noScreenshots}
          onChange={(blocked) => void setScreenshotsBlocked(blocked).then(() => setNoScreenshots(blocked))}
        />

        <SubTitle icon={Bomb}>Auto-destruction</SubTitle>
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
/** Server limits (server src/app.ts): 3 invitations waiting at once, 10 a day. */
function inviteError(e: unknown): string {
  if (e instanceof NetworkError) return 'Pas de réseau.';
  if (e instanceof ApiError && e.code === 'too_many_invites') {
    return 'Tu as déjà 3 invitations pas encore utilisées. Donne-les, ou attends qu’elles expirent (2 h après leur création).';
  }
  if (e instanceof ApiError && e.code === 'too_many_requests') return 'Limite de 10 invitations par jour atteinte. Réessaie demain.';
  return e instanceof ApiError ? `Erreur (${e.code})` : 'Erreur';
}

function Section({ title, icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <Panel title={title} icon={icon}>
      {children}
    </Panel>
  );
}

function SubTitle({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <View style={[styles.titleRow, styles.subTitleRow]}>
      <Icon size={18} color={colors.accentFg} />
      <Text style={styles.subTitle}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space.md, gap: space.lg, backgroundColor: colors.bg },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  subTitleRow: { marginTop: space.sm },
  subTitle: { color: colors.accentFg, fontSize: 15, fontFamily: fonts.semibold },
  inviteBox: { gap: space.sm, paddingVertical: space.sm },
  inviteExpiry: { ...type.dim, fontSize: 13, textAlign: 'center' },
  error: { color: colors.danger },
  // The safety number on the safe's screen: lit characters, as a code.
  fingerprintScreen: { paddingVertical: space.sm, paddingHorizontal: space.md },
  fingerprint: { color: lcd.on, fontSize: 18, fontFamily: mono, letterSpacing: 1, textAlign: 'center', lineHeight: 28, ...neon.text(lcd.on, 6) },
});
