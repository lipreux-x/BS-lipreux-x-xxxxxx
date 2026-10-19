import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { createGroup } from '@/services/groups';
import { Button } from '@/ui/Button';
import { CodeEntry } from '@/ui/CodeEntry';
import { KeywordsForm } from '@/ui/KeywordsForm';
import { LifetimePicker } from '@/ui/LifetimePicker';
import { colors, space, type } from '@/ui/theme';

/*
 * Key flow: the group key is drawn on this phone. Name and keywords are
 * encrypted with it; the server receives them encrypted, plus the code and
 * the keywords (to check future joins) and the key sealed for us. Locally
 * the key is locked by code + master key. An ephemeral group also gets its
 * self-destruct date, which the server enforces.
 */
type Step =
  | { kind: 'name' }
  | { kind: 'keywords' }
  | { kind: 'lifetime' }
  | { kind: 'code'; notice?: string }
  | { kind: 'confirm'; code: string };

export default function NewGroup() {
  const { session, openGroups } = useUnlocked();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'name' });
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState<string[] | undefined>();
  // Days before self-destruction, null for a permanent group.
  const [lifetime, setLifetime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (step.kind === 'keywords') {
    return (
      <KeywordsForm
        hint="3 mots-clés à donner en vrai avec le code : il faudra les deux pour rejoindre le groupe. Les membres les retrouvent dans la fiche du groupe."
        submitTitle="Continuer"
        initial={keywords}
        onSubmit={async (words) => {
          setKeywords(words);
          setStep({ kind: 'lifetime' });
          return null;
        }}
      />
    );
  }

  if (step.kind === 'lifetime') {
    return (
      <LifetimePicker
        initial={lifetime}
        onSubmit={(days) => {
          setLifetime(days);
          setStep({ kind: 'code' });
        }}
      />
    );
  }

  if (step.kind === 'code') {
    return (
      <View style={styles.center}>
        <CodeEntry
          key="code"
          initialError={step.notice}
          title="Code du groupe"
          subtitle="6 chiffres à partager à l’oral avec les membres."
          onComplete={async (code) => {
            setStep({ kind: 'confirm', code });
            return null;
          }}
        />
      </View>
    );
  }

  if (step.kind === 'confirm') {
    return (
      <View style={styles.center}>
        <CodeEntry
          key="confirm"
          title="Confirme le code"
          onComplete={async (code) => {
            if (code !== step.code) {
              setStep({ kind: 'code', notice: 'Les codes ne correspondent pas' });
              return null;
            }
            try {
              // Counted from now, so the time spent typing the code does not shorten it.
              const expiresAt = lifetime === null ? null : new Date(Date.now() + lifetime * 86_400_000);
              const { id, groupKey } = await createGroup(session, name.trim(), code, keywords!, expiresAt);
              openGroups.set(id, { keys: new Map([[1, groupKey]]), keyVersion: 1, name: name.trim() });
              return () => router.replace({ pathname: '/group/[id]', params: { id } });
            } catch (e) {
              if (e instanceof ApiError && e.code === 'code_taken') {
                setStep({ kind: 'code', notice: 'Ce code est déjà pris par un autre groupe, choisis-en un autre' });
                return null;
              }
              setStep({ kind: 'name' });
              setError(e instanceof NetworkError ? 'Pas de réseau.' : e instanceof ApiError ? `Création impossible (${e.code})` : 'Création impossible');
              return null;
            }
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={type.dim}>Le nom est chiffré : le serveur ne le voit jamais.</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Nom du groupe"
        placeholderTextColor={colors.textDim}
        maxLength={60}
        autoFocus
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Continuer" disabled={!name.trim()} onPress={() => setStep({ kind: 'keywords' })} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  form: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  input: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.md, fontSize: 16 },
  error: { color: colors.danger },
});
