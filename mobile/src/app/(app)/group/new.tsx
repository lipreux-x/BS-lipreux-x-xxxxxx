import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GROUP_CODE_LENGTH } from '@/crypto';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { createGroup } from '@/services/groups';
import { Button } from '@/ui/Button';
import { CodeEntry } from '@/ui/CodeEntry';
import { KeywordsForm } from '@/ui/KeywordsForm';
import { LifetimePicker } from '@/ui/LifetimePicker';
import { Field } from '@/ui/Screen';
import { Segment } from '@/ui/Segment';
import { colors, space, type } from '@/ui/theme';
import { Working } from '@/ui/Working';

/*
 * Key flow: the group key is drawn on this phone. Name and keywords are
 * encrypted with it; the server receives them encrypted, plus the code and
 * the keywords (to check future joins) and the key sealed for us. Locally
 * the key is locked by code + master key. An ephemeral group also gets its
 * self-destruct date, which the server enforces.
 *
 * Without a code: no keywords and no code steps. The key is kept under the
 * master key alone (the app code opens the group), and newcomers come in with
 * single-use links from the group's sheet.
 */
type Step =
  | { kind: 'name' }
  | { kind: 'keywords' }
  | { kind: 'lifetime' }
  | { kind: 'code'; notice?: string }
  | { kind: 'confirm'; code: string }
  | { kind: 'creating' };

type Access = 'code' | 'link';

export default function NewGroup() {
  const { session, openGroups } = useUnlocked();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'name' });
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState<string[] | undefined>();
  // Days before self-destruction, null for a permanent group.
  const [lifetime, setLifetime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<Access>('code');

  // Counted from now, so the time spent on the other steps does not shorten it.
  const expiry = (days: number | null) => (days === null ? null : new Date(Date.now() + days * 86_400_000));

  async function createWithoutCode(days: number | null) {
    setStep({ kind: 'creating' });
    try {
      const { id, groupKey } = await createGroup(session, name.trim(), null, [], expiry(days));
      openGroups.set(id, { keys: new Map([[1, groupKey]]), keyVersion: 1, name: name.trim(), link: true });
      router.replace({ pathname: '/group/[id]', params: { id } });
    } catch (e) {
      setStep({ kind: 'name' });
      setError(e instanceof NetworkError ? 'Pas de réseau.' : e instanceof ApiError ? `Création impossible (${e.code})` : 'Création impossible');
    }
  }

  if (step.kind === 'creating') {
    return (
      <View style={styles.center}>
        <Working />
      </View>
    );
  }

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
          if (access === 'link') void createWithoutCode(days);
          else setStep({ kind: 'code' });
        }}
      />
    );
  }

  if (step.kind === 'code') {
    return (
      <View style={styles.center}>
        <CodeEntry
          length={GROUP_CODE_LENGTH}
          key="code"
          initialError={step.notice}
          title="Code du groupe"
          subtitle="4 chiffres à partager à l’oral avec les membres."
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
          length={GROUP_CODE_LENGTH}
          key="confirm"
          title="Confirme le code"
          onComplete={async (code) => {
            if (code !== step.code) {
              setStep({ kind: 'code', notice: 'Les codes ne correspondent pas' });
              return null;
            }
            try {
              const { id, groupKey } = await createGroup(session, name.trim(), code, keywords!, expiry(lifetime));
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
      <Field value={name} onChangeText={setName} placeholder="Nom du groupe" maxLength={60} autoFocus />
      <Segment
        options={[
          { label: 'Coffre à code', value: 'code' as Access },
          { label: 'Coffre sans code', value: 'link' as Access },
        ]}
        value={access}
        onChange={setAccess}
      />
      <Text style={type.dim}>
        {access === 'code'
          ? 'Le plus sûr : pour entrer, il faut un code à 4 chiffres et 3 mots-clés, donnés en vrai. Le code se tape à chaque ouverture.'
          : 'Tu invites chaque membre avec un lien, valable une seule fois, et tu acceptes sa demande. Le groupe s’ouvre avec le code de l’app. Les messages restent chiffrés : le serveur ne peut pas les lire.'}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Continuer" disabled={!name.trim()} onPress={() => setStep(access === 'link' ? { kind: 'lifetime' } : { kind: 'keywords' })} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  form: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  error: { color: colors.danger },
});
