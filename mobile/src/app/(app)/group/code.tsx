import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { changeGroupCode } from '@/services/groups';
import { CodeEntry } from '@/ui/CodeEntry';
import { KeywordsForm } from '@/ui/KeywordsForm';
import { colors } from '@/ui/theme';

/*
 * Key flow: no new group key. The server re-hashes code + keywords for future
 * joins and stores the meta re-encrypted with the new keywords; this phone
 * re-locks the current key under the new code. Other members are asked for
 * the new code the next time they open the group (code_version).
 */
type Step = { kind: 'keywords' } | { kind: 'code'; notice?: string } | { kind: 'confirm'; code: string };

export default function ChangeGroupCode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, openGroups } = useUnlocked();
  const [step, setStep] = useState<Step>({ kind: 'keywords' });
  const [current, setCurrent] = useState<string[] | null | undefined>(undefined);
  const [keywords, setKeywords] = useState<string[]>([]);

  useEffect(() => {
    void session.vault.meta(id, session.masterKey).then((m) => setCurrent(m?.keywords ?? null));
  }, [session, id]);

  if (current === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accentFg} />
      </View>
    );
  }

  if (step.kind === 'keywords') {
    return (
      <KeywordsForm
        hint="Les 3 mots-clés à donner avec le nouveau code pour rejoindre le groupe. Garde les mêmes ou changes-en."
        submitTitle="Continuer"
        initial={keywords.length ? keywords : (current ?? undefined)}
        onSubmit={async (words) => {
          setKeywords(words);
          setStep({ kind: 'code' });
          return null;
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
          title="Nouveau code du groupe"
          subtitle="Les membres devront le taper à leur prochaine ouverture du groupe."
          onComplete={async (code) => {
            setStep({ kind: 'confirm', code });
            return null;
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <CodeEntry
        key="confirm"
        title="Confirme le nouveau code"
        onComplete={async (code) => {
          if (code !== step.code) {
            setStep({ kind: 'code', notice: 'Les codes ne correspondent pas' });
            return null;
          }
          const open = openGroups.get(id);
          if (!open) return 'Rouvre le groupe puis réessaie';
          try {
            await changeGroupCode(session, id, open.keys, open.keyVersion, code, keywords);
            return () => router.back();
          } catch (e) {
            if (e instanceof ApiError && e.code === 'code_taken') {
              setStep({ kind: 'code', notice: 'Ce code est déjà pris par un autre groupe, choisis-en un autre' });
              return null;
            }
            if (e instanceof NetworkError) return 'Pas de réseau';
            if (e instanceof ApiError && e.code === 'stale_key_version') return 'La clé du groupe vient de changer, réessaie';
            return 'Impossible de changer le code';
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
