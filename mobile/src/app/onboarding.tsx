import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { Button } from '@/ui/Button';
import { CodeEntry } from '@/ui/CodeEntry';
import { colors, space, type } from '@/ui/theme';

/*
 * SPEC §2.5: invite -> pseudo -> app code (twice) -> keys generated on the
 * phone -> account created. The app code never leaves the phone.
 */

type Step = { kind: 'welcome' } | { kind: 'code'; notice?: string } | { kind: 'confirm'; code: string };

const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;

export default function Onboarding() {
  const { register } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'welcome' });
  const [invite, setInvite] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canContinue = invite.replace(/[^0-9A-Za-z]/g, '').length >= 16 && USERNAME.test(username);

  if (step.kind === 'code') {
    return (
      <SafeAreaView style={styles.center}>
        <CodeEntry
          key="code"
          initialError={step.notice}
          title="Choisis ton code"
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
          subtitle="Création de tes clés sur le téléphone…"
          onComplete={async (code) => {
            if (code !== step.code) {
              setStep({ kind: 'code', notice: 'Les codes ne correspondent pas' });
              return null;
            }
            try {
              await register({ inviteCode: invite, username, appCode: code });
              return null;
            } catch (e) {
              setStep({ kind: 'welcome' });
              setError(describe(e));
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.form}>
        <Text style={type.title}>BaseSecrète</Text>
        <Text style={type.dim}>Entrée sur invitation uniquement.</Text>

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

        <Text style={styles.label}>Pseudo</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="3 à 24 caractères"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          title="Continuer"
          disabled={!canContinue}
          onPress={() => {
            setError(null);
            setStep({ kind: 'code' });
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function describe(e: unknown): string {
  if (e instanceof NetworkError) return 'Pas de réseau. Réessaie quand tu es connecté.';
  if (e instanceof ApiError) {
    if (e.code === 'invalid_invite') return 'Invitation invalide, déjà utilisée ou expirée.';
    if (e.code === 'username_taken') return 'Ce pseudo est déjà pris.';
    if (e.code === 'invalid_body') return 'Pseudo invalide (lettres, chiffres, . _ -).';
  }
  return 'Inscription impossible. Réessaie.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  stripes: { flexDirection: 'row', height: 56 },
  stripe: { flex: 1 },
  form: { flex: 1, padding: space.lg, gap: space.sm, justifyContent: 'center' },
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
  error: { color: colors.danger, marginVertical: space.sm },
});
