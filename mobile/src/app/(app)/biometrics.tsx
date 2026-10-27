import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { LockedOutError, WipedError, WrongCodeError } from '@/services/vault';
import { CodeEntry, type CodeResult } from '@/ui/CodeEntry';
import { colors } from '@/ui/theme';

/** Turning fingerprint unlock on: the app code again, then the system asks for the finger once. */
export default function EnableBiometrics() {
  const { enableBiometrics } = useUnlocked();
  const [lockedFor, setLockedFor] = useState(0);

  async function submit(code: string): Promise<CodeResult> {
    try {
      await enableBiometrics(code);
      return () => router.back();
    } catch (e) {
      if (e instanceof WrongCodeError) return 'Code incorrect';
      if (e instanceof LockedOutError) {
        setLockedFor(e.retryInMs);
        return 'Trop d’essais';
      }
      if (e instanceof WipedError) return 'Données effacées';
      return 'Biométrie refusée ou indisponible';
    }
  }

  return (
    <View style={styles.screen}>
      <CodeEntry title="Confirme ton code" subtitle="Pour ouvrir l’app sans le code, avec ton empreinte ou ton visage." onComplete={submit} lockedForMs={lockedFor} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
