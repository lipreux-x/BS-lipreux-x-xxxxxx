import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CryptoError, isValidPassword, MIN_PASSWORD_LENGTH, NativeCryptoMissingError, passwordProblem } from '@/crypto';
import { useSession, type RecoveredAccount } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { Button } from '@/ui/Button';
import { CodeEntry } from '@/ui/CodeEntry';
import { Wordmark } from '@/ui/Wordmark';
import { colors, fonts, space, type } from '@/ui/theme';

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [recovered, setRecovered] = useState<RecoveredAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = mode === 'login';
  const canContinue = login
    ? USERNAME.test(username) && password.length > 0
    : invite.replace(/[^0-9A-Za-z]/g, '').length >= 16 && USERNAME.test(username) && isValidPassword(password) && password === password2;

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

  if (step.kind === 'code') {
    return (
      <SafeAreaView style={styles.center}>
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
              if (login && recovered) await restore(recovered, code);
              else await register({ inviteCode: invite, username, password, appCode: code });
              return null;
            } catch (e) {
              setStep({ kind: 'form' });
              setError(login ? describeLogin(e) : describeRegister(e));
              return null;
            }
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.stripes} accessibilityElementsHidden>
        {Array.from({ length: 12 }, (_, i) => (
          <View key={i} style={[styles.stripe, { backgroundColor: i % 2 ? colors.bg : colors.text }]} />
        ))}
      </View>
      {/* 'padding' on both platforms: Android is edge-to-edge and no longer resizes for the keyboard. */}
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Wordmark />
          <Text style={type.dim}>{login ? 'Retrouve ton compte sur ce téléphone.' : 'Entrée sur invitation uniquement.'}</Text>

          {login ? null : (
            <>
              <Text style={styles.label}>Code d’invitation</Text>
              <TextInput
                value={invite}
                onChangeText={(t) => setInvite(t.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                placeholderTextColor={colors.textDim}
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.input}
              />
            </>
          )}

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
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={login ? 'Ton mot de passe' : `${MIN_PASSWORD_LENGTH} caractères minimum`}
            placeholderTextColor={colors.textDim}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType={login ? 'password' : 'newPassword'}
            style={styles.input}
          />
          {login ? null : (
            <>
              <TextInput
                value={password2}
                onChangeText={setPassword2}
                placeholder="Confirme le mot de passe"
                placeholderTextColor={colors.textDim}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                style={styles.input}
              />
              <Text style={styles.hint}>
                {password && passwordProblem(password)
                  ? passwordProblem(password)
                  : password2 && password !== password2
                    ? 'Les mots de passe ne correspondent pas.'
                    : 'Il sert à te reconnecter si tu changes de téléphone ou réinstalles l’app. Personne ne peut le retrouver pour toi.'}
              </Text>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy ? <Text style={styles.hint}>Vérification… quelques secondes.</Text> : null}
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

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => switchMode(login ? 'register' : 'login')}
            style={styles.switch}
          >
            <Text style={styles.switchText}>
              {login ? 'J’ai une invitation : créer un compte' : 'Déjà un compte ? Se connecter'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  stripes: { flexDirection: 'row', height: 56 },
  stripe: { flex: 1 },
  form: { flexGrow: 1, padding: space.lg, gap: space.sm, justifyContent: 'center' },
  label: { ...type.dim, marginTop: space.md },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 16,
    marginBottom: space.sm,
  },
  hint: { ...type.dim, fontSize: 13 },
  error: { color: colors.danger, marginVertical: space.sm },
  switch: { alignSelf: 'center', paddingVertical: space.md, paddingHorizontal: space.sm },
  switchText: { color: colors.accentFg, fontFamily: fonts.semibold, fontSize: 15 },
});
