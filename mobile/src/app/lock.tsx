import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeCryptoMissingError } from '@/crypto';
import { useSession } from '@/session/SessionProvider';
import { LockedOutError, WrongCodeError } from '@/services/vault';
import { CodeEntry, type CodeResult } from '@/ui/CodeEntry';
import { calm } from '@/ui/theme';
import { VaultDoor } from '@/ui/VaultDoor';

// SPEC §2.1: vault door; tap -> it unlocks and opens -> a calm keypad for the 6-digit app code.
// The vault look is only for the opening; the code screen stays quiet. The door ends with the
// vault's inside (painted `calm`) filling the screen, so the calm background shows at once and
// only the keypad fades in, as if it were waiting inside.
export default function LockScreen() {
  const { status, vault, unlock } = useSession();
  const [opened, setOpened] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  const [reveal] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!opened) return;
    Animated.timing(reveal, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [opened, reveal]);

  useEffect(() => {
    void vault.appLockoutRemainingMs().then(setLockedFor);
  }, [vault]);

  async function submit(code: string): Promise<CodeResult> {
    try {
      return await unlock(code);
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
      // Expo Go or a build without the native module: keys cannot be protected properly.
      if (e instanceof NativeCryptoMissingError) return 'Version de l’app incomplète : installe celle du store';
      throw e;
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      {opened ? <Animated.View style={[StyleSheet.absoluteFill, calm]} /> : null}
      {opened ? (
        <Animated.View
          style={{
            opacity: reveal,
            transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
          }}
        >
          <CodeEntry
            title="Code BaseSecrète"
            subtitle={status.kind === 'locked' ? status.username : undefined}
            onComplete={submit}
            lockedForMs={lockedFor}
          />
        </Animated.View>
      ) : (
        <VaultDoor hint="Touche le coffre" onOpen={() => setOpened(true)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
