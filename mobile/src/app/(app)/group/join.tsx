import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { joinGroup } from '@/services/groups';
import { CodeEntry } from '@/ui/CodeEntry';
import { KeywordsForm } from '@/ui/KeywordsForm';
import { colors } from '@/ui/theme';

/*
 * Key flow: the code identifies the group. The server checks it together with
 * the 3 keywords (5 tries/hour) and adds us as member. The group key is NOT
 * sent here: a member who has it seals it to our public key the next time
 * they open the group.
 */
type Step = { kind: 'code'; notice?: string } | { kind: 'keywords'; code: string };

export default function JoinGroup() {
  const { session } = useUnlocked();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'code' });

  if (step.kind === 'keywords') {
    return (
      <KeywordsForm
        hint="Les 3 mots-clés du groupe, donnés par un membre avec le code. Majuscules, accents et ordre n’ont pas d’importance."
        submitTitle="Rejoindre"
        onSubmit={async (words) => {
          try {
            const id = await joinGroup(session, step.code, words);
            router.replace({ pathname: '/group/[id]', params: { id } });
            return null;
          } catch (e) {
            if (e instanceof NetworkError) return 'Pas de réseau';
            if (e instanceof ApiError && e.code === 'too_many_attempts') return 'Trop d’essais. Réessaie dans une heure.';
            if (e instanceof ApiError && e.code === 'wrong_code') {
              setStep({ kind: 'code', notice: 'Code ou mots-clés incorrects' });
              return null;
            }
            return 'Impossible de rejoindre';
          }
        }}
      />
    );
  }

  return (
    <View style={styles.center}>
      <CodeEntry
        key={step.notice ?? 'code'}
        title="Code du groupe"
        subtitle="Demande-le à un membre, en vrai, avec les 3 mots-clés."
        initialError={step.notice}
        onComplete={async (code) => {
          setStep({ kind: 'keywords', code });
          return null;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
