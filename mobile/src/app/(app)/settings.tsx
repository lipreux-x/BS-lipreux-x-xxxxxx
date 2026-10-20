import { router, useFocusEffect } from 'expo-router';
import { Bell, Bomb, CameraOff, FingerprintPattern, Lock, ShieldCheck, type LucideIcon, User, UserPlus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keyFingerprint } from '@/crypto';
import { useUnlocked } from '@/session/SessionProvider';
import { copySensitive } from '@/services/clipboard';
import { ApiError, NetworkError } from '@/services/api';
import { registerPush, type PushStatus } from '@/services/push';
import { WIPE_AFTER_CHOICES } from '@/services/vault';
import { Avatar, isAvatarId, type AvatarId } from '@/ui/avatars';
import { AvatarPicker } from '@/ui/AvatarPicker';
import { Button } from '@/ui/Button';
import { timeLabel } from '@/ui/chat/timeline';
import { InviteCodeDisplay } from '@/ui/InviteCode';
import { colors, mono, space, type } from '@/ui/theme';

export default function Settings() {
  const { session, profiles, vault, lock, setScreenshotsBlocked } = useUnlocked();
  const insets = useSafeAreaInsets();
  // Per-phone security options, read from the Secure Store (undefined until then).
  const [wipeAfter, setWipeAfter] = useState<number | null | undefined>(undefined);
  const [noScreenshots, setNoScreenshots] = useState<boolean | undefined>(undefined);
  const [bioOn, setBioOn] = useState<boolean | undefined>(undefined);
  const [bioAvailable, setBioAvailable] = useState(false);
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
    // Edge to edge: the last options stay above the navigation bar / home indicator.
    <ScrollView contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + space.md }]}>
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
        <Text style={styles.fingerprint} selectable>
          {keyFingerprint(session.identity)}
        </Text>
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

        <SubTitle icon={FingerprintPattern}>Empreinte digitale</SubTitle>
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

        <SubTitle icon={Bell}>Notifications</SubTitle>
        <Text style={type.dim}>
          {push === 'on'
            ? 'Activées. Elles disent seulement « uçer egassem » (« message reçu » à l’envers) : ni nom, ni groupe, ni texte. En touchant la notification, tu tapes tes codes, puis le groupe s’ouvre.'
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

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Icon size={16} color={colors.accentFg} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
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
  section: { gap: space.sm, padding: space.md, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { color: colors.accentFg, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  subTitleRow: { marginTop: space.sm },
  subTitle: { color: colors.accentFg, fontSize: 15, fontWeight: '600' },
  inviteBox: { gap: space.sm, paddingVertical: space.sm },
  inviteExpiry: { ...type.dim, fontSize: 13, textAlign: 'center' },
  error: { color: colors.danger },
  segment: { flexDirection: 'row', gap: space.sm },
  option: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  optionOn: { backgroundColor: colors.accent, borderColor: colors.accentFg },
  optionText: { color: colors.textDim, fontSize: 14 },
  optionTextOn: { color: colors.text, fontWeight: '600' },
  fingerprint: { color: colors.text, fontSize: 18, fontFamily: mono, letterSpacing: 1, textAlign: 'center', lineHeight: 28 },
});
