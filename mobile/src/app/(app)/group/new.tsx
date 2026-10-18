import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { createGroup } from '@/services/groups';
import { Button } from '@/ui/Button';
import { CodeEntry } from '@/ui/CodeEntry';
import { colors, space, type } from '@/ui/theme';

/*
 * Key flow: the group key is drawn on this phone. The name is encrypted with
 * it; the server receives the encrypted name, the code (to check future joins)
 * and the key sealed for us. Locally the key is locked by code + master key.
 */
type Step = { kind: 'name' } | { kind: 'code'; notice?: string } | { kind: 'confirm'; code: string };

export default function NewGroup() {
  const { session, openGroups } = useUnlocked();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'name' });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

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
              const { id, groupKey } = await createGroup(session, name.trim(), code);
              openGroups.set(id, { groupKey, keyVersion: 1, name: name.trim() });
              router.replace({ pathname: '/group/[id]', params: { id } });
              return null;
            } catch (e) {
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
      <Button title="Continuer" disabled={!name.trim()} onPress={() => setStep({ kind: 'code' })} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  form: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  input: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.md, fontSize: 16 },
  error: { color: colors.danger },
});
