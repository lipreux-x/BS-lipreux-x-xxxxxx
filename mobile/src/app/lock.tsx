import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeCryptoMissingError } from '@/crypto';
import { useSession } from '@/session/SessionProvider';
import { LockedOutError, WipedError, WrongCodeError } from '@/services/vault';
import { CodeEntry, type CodeResult } from '@/ui/CodeEntry';
import { calm, colors, fonts, space } from '@/ui/theme';
import { VaultDoor } from '@/ui/VaultDoor';

// SPEC §2.1: vault door; tap -> it unlocks and opens -> a calm keypad for the 6-digit app code.
// The vault look is only for the opening; the code screen stays quiet. The door ends with the
// vault's inside (painted `calm`) filling the screen, so the calm background shows at once and
// only the keypad fades in, as if it were waiting inside.
// With the fingerprint on (Settings), opening the door asks for the finger first; the keypad stays
// underneath for when it is cancelled, fails, or the code is due (every 48 h).
export default function LockScreen() {
  const { status, vault, unlock, unlockWithBiometrics } = useSession();
  const [opened, setOpened] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  const [bio, setBio] = useState(false);
  const [reveal] = useState(() => new Animated.Value(0));

  useEffect(() => {
    void vault.canUseBiometrics().then(setBio);
  }, [vault]);

  async function tryBiometrics() {
    const enter = await unlockWithBiometrics().catch(() => null);
    if (enter) enter();
    else setBio(await vault.canUseBiometrics());
  }

  function open() {
    setOpened(true);
    if (bio) void tryBiometrics();
  }

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
        return e.attemptsBeforeWipe !== null ? `Trop d’essais — ${beforeWipe(e.attemptsBeforeWipe)}` : 'Trop d’essais';
      }
      if (e instanceof WrongCodeError) {
        // Close to the self-destruct threshold, that warning wins over the delay one.
        if (e.attemptsBeforeWipe !== null && e.attemptsBeforeWipe <= 5) return `Code incorrect — ${beforeWipe(e.attemptsBeforeWipe)}`;
        return e.attemptsBeforeDelay > 0
          ? `Code incorrect — encore ${e.attemptsBeforeDelay} essai${e.attemptsBeforeDelay > 1 ? 's' : ''} avant blocage`
          : 'Code incorrect';
      }
      // Erased: the session switches to onboarding, this screen goes away.
      if (e instanceof WipedError) return 'Données effacées';
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
          {bio ? (
            <Pressable accessibilityRole="button" onPress={() => void tryBiometrics()} style={styles.bio} hitSlop={8}>
              <Text style={styles.bioText}>Ouvrir avec l’empreinte</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : (
        <VaultDoor hint="Touche le coffre" onOpen={open} />
      )}
    </SafeAreaView>
  );
}

function beforeWipe(n: number): string {
  return `effacement de l’app après ${n} essai${n > 1 ? 's' : ''} de plus`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bio: { alignSelf: 'center', marginTop: space.lg, paddingVertical: space.sm, paddingHorizontal: space.md },
  bioText: { color: colors.accentFg, fontFamily: fonts.medium, fontSize: 16 },
});
