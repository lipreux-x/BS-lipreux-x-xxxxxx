import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeCryptoMissingError } from '@/crypto';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { joinGroup } from '@/services/groups';
import { CodeEntry } from '@/ui/CodeEntry';
import { KeywordsForm } from '@/ui/KeywordsForm';
import { colors, space } from '@/ui/theme';

/*
 * Key flow: the code + 3 keywords never leave the phone; a key derived from
 * them finds the group (5 tries/hour). That only files a request: an admin
 * approves it from their phone (after comparing our fingerprint in person),
 * which hands us the group key wrapped under the code.
 *
 * Keywords first, code last: the code is checked as it is typed, so the safe
 * display shows blue (joined) or red (wrong code or keywords) right away.
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
            if (e instanceof NativeCryptoMissingError) return 'Version de l’app incomplète : installe celle du store';
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
