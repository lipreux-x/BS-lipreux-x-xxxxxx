import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/session/SessionProvider';
import { remainingMs } from '@/services/lockout';
import { LockedOutError, WrongCodeError } from '@/services/vault';
import { CodeEntry } from '@/ui/CodeEntry';
import { colors, space, type } from '@/ui/theme';
import { VaultSquare } from '@/ui/VaultSquare';

// SPEC §2.1: black screen, breathing square; tap -> keypad for the 6-digit app code.
export default function LockScreen() {
  const { status, vault, unlock } = useSession();
  const [opened, setOpened] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);

  useEffect(() => {
    void vault.appLockout().then((s) => setLockedFor(remainingMs(s, Date.now())));
  }, [vault]);

  async function submit(code: string): Promise<string | null> {
    try {
      await unlock(code);
      return null;
    } catch (e) {
      if (e instanceof LockedOutError) {
        setLockedFor(e.retryInMs);
        return 'Trop d’essais';
      }
      if (e instanceof WrongCodeError) {
        return e.attemptsBeforeDelay > 0
          ? `Code incorrect — encore ${e.attemptsBeforeDelay} essai${e.attemptsBeforeDelay > 1 ? 's' : ''} avant blocage`
          : 'Code incorrect';
      }
      throw e;
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      {opened ? (
        <CodeEntry
          title="Code BaseSecrète"
          subtitle={status.kind === 'locked' ? status.username : undefined}
          onComplete={submit}
          lockedForMs={lockedFor}
        />
      ) : (
        <View style={styles.center}>
          <VaultSquare onOpen={() => setOpened(true)} />
          <Text style={[type.dim, { marginTop: space.xl }]}>Touche le coffre</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center' },
});
