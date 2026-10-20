import { useEffect, useMemo, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CryptoError, isValidPassword, MIN_PASSWORD_LENGTH, NativeCryptoMissingError, passwordProblem } from '@/crypto';
import { useSession, type RecoveredAccount } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { Button } from '@/ui/Button';
import { CodeEntry } from '@/ui/CodeEntry';
import { INVITE_LENGTH } from '@/ui/invite';
import { InviteCodeInput } from '@/ui/InviteCode';
import { Led, type LedState } from '@/ui/Led';
import { PasswordField } from '@/ui/PasswordField';
import { Wordmark } from '@/ui/Wordmark';
import { colors, fonts, mono, space, type } from '@/ui/theme';

/*
 * SPEC §2.5: invite -> pseudo + password -> app code (twice) -> keys generated
 * on the phone -> account created. The app code never leaves the phone; the
 * password seals a copy of the keys kept by the server, so that "Se connecter"
 * (pseudo + password, then a new app code) brings the account back on a phone
 * that lost its data.
 */

type Mode = 'register' | 'login';
type Step = { kind: 'form' } | { kind: 'code'; notice?: string } | { kind: 'confirm'; code: string };

const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;

export default function Onboarding() {
  const { register, recover, restore } = useSession();
  const [mode, setMode] = useState<Mode>('register');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [invite, setInvite] = useState('');
  // Refused by the server: the invitation display turns red until it is changed.
  const [badInvite, setBadInvite] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [recovered, setRecovered] = useState<RecoveredAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = mode === 'login';
  const canContinue = login
    ? USERNAME.test(username) && password.length > 0
    : invite.length === INVITE_LENGTH && USERNAME.test(username) && isValidPassword(password) && password === password2;

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setPassword2('');
  }

  async function signIn() {
    setError(null);
    setBusy(true);
    // Let the spinner render before the (synchronous) key derivation starts.
    await new Promise((r) => setTimeout(r, 50));
    try {
      setRecovered(await recover({ username, password }));
      setPassword('');
      setStep({ kind: 'code' });
    } catch (e) {
      setError(describeLogin(e));
    } finally {
      setBusy(false);
    }
  }

  const insets = useSafeAreaInsets();
  // Back from the code steps: to the previous step, not out of the app (the form keeps what was typed).
  const back = useMemo(
    () => (step.kind === 'confirm' ? () => setStep({ kind: 'code' }) : step.kind === 'code' ? () => setStep({ kind: 'form' }) : null),
    [step.kind],
  );
  useEffect(() => {
    if (!back) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [back]);
  const backLink = back ? (
    <Pressable onPress={back} hitSlop={12} style={[styles.back, { top: insets.top + space.sm }]}>
      <Text style={styles.backText}>‹ Retour</Text>
    </Pressable>
  ) : null;

  if (step.kind === 'code') {
    return (
      <SafeAreaView style={styles.center}>
        {backLink}
        <CodeEntry
          key="code"
          initialError={step.notice}
          title={login ? 'Nouveau code pour ce téléphone' : 'Choisis ton code'}
          subtitle="6 chiffres pour ouvrir l’app. Il ne quitte jamais ton téléphone."
          onComplete={async (code) => {
            if (/^(\d)\1{5}$/.test(code) || '0123456789'.includes(code) || '9876543210'.includes(code)) {
              return 'Code trop simple, choisis-en un autre';
            }
            setStep({ kind: 'confirm', code });
            return null;
          }}
        />
      </SafeAreaView>
    );
  }

  if (step.kind === 'confirm') {
    return (
      <SafeAreaView style={styles.center}>
        {backLink}
        <CodeEntry
          key="confirm"
          title="Confirme ton code"
          subtitle={login ? 'Enregistrement de ton compte sur ce téléphone…' : 'Création de tes clés sur le téléphone…'}
          onComplete={async (code) => {
            if (code !== step.code) {
              setStep({ kind: 'code', notice: 'Les codes ne correspondent pas' });
              return null;
            }
            try {
              // Green LED and a success buzz on the code just typed, then straight to the home:
              // the code was typed twice already, no need to type it a third time.
              return login && recovered ? await restore(recovered, code) : await register({ inviteCode: invite, username, password, appCode: code });
            } catch (e) {
              setStep({ kind: 'form' });
              setError(login ? describeLogin(e) : describeRegister(e));
              setBadInvite(!login && e instanceof ApiError && e.code === 'invalid_invite');
              return null;
            }
          }}
        />
      </SafeAreaView>
    );
  }

  const passwordState: LedState = !password
    ? 'off'
    : passwordProblem(password)
      ? 'amber'
      : password2 && password !== password2
        ? 'red'
        : password === password2
          ? 'green'
          : 'off';

  return (
    <SafeAreaView style={styles.screen}>
      <Stripes />
      {/* 'padding' on both platforms: Android is edge-to-edge and no longer resizes for the keyboard. */}
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Wordmark size={34} />
            <Text style={[type.dim, styles.centerText]}>
              {login ? 'Retrouve ton compte sur ce téléphone.' : 'Entrée sur invitation uniquement.'}
            </Text>
          </View>

          <View style={styles.segment}>
            {(['register', 'login'] as const).map((m) => {
              const on = mode === m;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  disabled={busy || on}
                  onPress={() => switchMode(m)}
                  style={[styles.option, on && styles.optionOn]}
                >
                  <Text style={[styles.optionText, on && styles.optionTextOn]}>{m === 'login' ? 'Se connecter' : 'Créer un compte'}</Text>
                </Pressable>
              );
            })}
          </View>

          {login ? null : (
            <Card title="Invitation">
              <InviteCodeInput
                value={invite}
                onChange={(code) => {
                  setInvite(code);
                  setBadInvite(false);
                }}
                error={badInvite}
              />
              <Text style={styles.hint}>16 caractères, donnés par un membre. Valable 2 heures. Pas besoin de taper les tirets.</Text>
            </Card>
          )}

          <Card title={login ? 'Ton compte' : 'Ton profil'}>
            <Text style={styles.label}>Pseudo</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="3 à 24 caractères"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              style={styles.input}
            />

            <Text style={styles.label}>Mot de passe</Text>
            <PasswordField
              value={password}
              onChangeText={setPassword}
              placeholder={login ? 'Ton mot de passe' : `${MIN_PASSWORD_LENGTH} caractères minimum`}
              textContentType={login ? 'password' : 'newPassword'}
              style={styles.input}
            />
            {login ? null : (
              <>
                <PasswordField
                  value={password2}
                  onChangeText={setPassword2}
                  placeholder="Confirme le mot de passe"
                  textContentType="newPassword"
                  style={styles.input}
                />
                <View style={styles.status}>
                  <View style={styles.statusLed}>
                    <Led state={passwordState} />
                  </View>
                  <Text style={[styles.hint, styles.flex]}>
                    {password && passwordProblem(password)
                      ? passwordProblem(password)
                      : password2 && password !== password2
                        ? 'Les mots de passe ne correspondent pas.'
                        : 'Il sert à te reconnecter si tu changes de téléphone ou réinstalles l’app. Personne ne peut le retrouver pour toi.'}
                  </Text>
                </View>
              </>
            )}
          </Card>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy ? <Text style={[styles.hint, styles.centerText]}>Vérification… quelques secondes.</Text> : null}
          <Button
            title={login ? 'Se connecter' : 'Continuer'}
            busy={busy}
            disabled={!canContinue}
            onPress={() => {
              if (login) return void signIn();
              setError(null);
              setStep({ kind: 'code' });
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Fine black and white stripes along the top, a nod to Sephora (SPEC §8, this screen only). */
function Stripes() {
  return (
    <View style={styles.stripes} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: 48 }, (_, i) => (
        <View key={i} style={[styles.flex, { backgroundColor: i % 2 ? colors.bg : colors.text }]} />
      ))}
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function describeRegister(e: unknown): string {
  if (e instanceof NetworkError) return 'Pas de réseau. Réessaie quand tu es connecté.';
  if (e instanceof NativeCryptoMissingError) return 'Version de l’app incomplète : installe celle du store.';
  if (e instanceof ApiError) {
    if (e.code === 'invalid_invite') return 'Invitation invalide, déjà utilisée ou expirée.';
    if (e.code === 'username_taken') return 'Ce pseudo est déjà pris.';
    if (e.code === 'invalid_body') return 'Pseudo invalide (lettres, chiffres, . _ -).';
  }
  return 'Inscription impossible. Réessaie.';
}

function describeLogin(e: unknown): string {
  if (e instanceof NetworkError) return 'Pas de réseau. Réessaie quand tu es connecté.';
  if (e instanceof NativeCryptoMissingError) return 'Version de l’app incomplète : installe celle du store.';
  // The server asked for a weaker protection than the app's: refused, the password is not exposed.
  if (e instanceof CryptoError && e.code === 'INVALID_INPUT') return 'Réponse du serveur refusée par sécurité. Réessaie plus tard.';
  if (e instanceof ApiError) {
    if (e.code === 'bad_credentials') return 'Pseudo ou mot de passe incorrect.';
    if (e.code === 'too_many_attempts') return 'Trop d’essais. Réessaie dans une heure.';
    if (e.code === 'invalid_body') return 'Pseudo invalide (lettres, chiffres, . _ -).';
  }
  return 'Connexion impossible. Réessaie.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  back: { position: 'absolute', left: space.md, zIndex: 1 },
  backText: { color: colors.accentFg, fontSize: 16 },
  stripes: { flexDirection: 'row', height: 10, opacity: 0.85 },
  form: { flexGrow: 1, padding: space.lg, gap: space.md, justifyContent: 'center' },
  header: { alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  segment: { flexDirection: 'row', gap: space.sm },
  option: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  optionOn: { backgroundColor: colors.accent, borderColor: colors.accentFg },
  optionText: { color: colors.textDim, fontFamily: fonts.medium, fontSize: 15 },
  optionTextOn: { color: colors.text, fontFamily: fonts.semibold },
  card: { gap: space.sm, padding: space.md, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardTitle: { color: colors.accentFg, fontFamily: mono, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', marginBottom: space.xs },
  label: { ...type.dim, fontSize: 13 },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 16,
    marginBottom: space.xs,
  },
  hint: { ...type.dim, fontSize: 13, lineHeight: 18 },
  status: { flexDirection: 'row', gap: space.sm },
  // Centred on the first line of the hint.
  statusLed: { height: 18, justifyContent: 'center' },
  error: { color: colors.danger, textAlign: 'center' },
});
