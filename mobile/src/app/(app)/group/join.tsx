import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { joinGroup } from '@/services/groups';
import { CodeEntry } from '@/ui/CodeEntry';
import { KeywordsForm } from '@/ui/KeywordsForm';
import { colors, space } from '@/ui/theme';

/*
 * Key flow: the code identifies the group. The server checks it together with
 * the 3 keywords (5 tries/hour) and adds us as member. The group key is NOT
 * sent here: a member who has it seals it to our public key the next time
 * they open the group.
 *
 * Keywords first, code last: the code is checked as it is typed, so the safe
 * display shows green (joined) or red (wrong code or keywords) right away.
 */
type Step = { kind: 'keywords'; words?: string[] } | { kind: 'code'; words: string[] };

export default function JoinGroup() {
  const { session } = useUnlocked();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'keywords' });

  if (step.kind === 'keywords') {
    return (
      <KeywordsForm
        hint="Les 3 mots-clés du groupe, donnés par un membre avec le code. Majuscules, accents et ordre n’ont pas d’importance."
        submitTitle="Continuer"
        initial={step.words}
        onSubmit={async (words) => {
          setStep({ kind: 'code', words });
          return null;
        }}
      />
    );
  }

  const { words } = step;
  return (
    <View style={styles.center}>
      <CodeEntry
        title="Code du groupe"
        subtitle="Demande-le à un membre, en vrai, avec les 3 mots-clés."
        onComplete={async (code) => {
          try {
            const id = await joinGroup(session, code, words);
            return () => router.replace({ pathname: '/group/[id]', params: { id } });
          } catch (e) {
            if (e instanceof NetworkError) return 'Pas de réseau';
            if (e instanceof ApiError && e.code === 'too_many_attempts') return 'Trop d’essais. Réessaie dans une heure.';
            if (e instanceof ApiError && e.code === 'wrong_code') return 'Code ou mots-clés incorrects';
            return 'Impossible de rejoindre';
          }
        }}
      />
      <Pressable onPress={() => setStep({ kind: 'keywords', words })} hitSlop={8} style={styles.back}>
        <Text style={styles.backLabel}>Modifier les mots-clés</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  back: { marginTop: space.lg },
  backLabel: { color: colors.accentFg, fontSize: 15 },
});
