import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeCryptoMissingError } from '@/crypto';
import { useSession } from '@/session/SessionProvider';
import { LockedOutError, WipedError, WrongCodeError } from '@/services/vault';
import { CodeEntry, type CodeResult } from '@/ui/CodeEntry';
import { FingerprintPad } from '@/ui/FingerprintPad';
import { calm, colors, fonts, space, type } from '@/ui/theme';
import { VaultDoor } from '@/ui/VaultDoor';

// SPEC §2.1: vault door; tap -> it unlocks and opens -> a calm keypad for the 6-digit app code.
// The vault look is only for the opening; the code screen stays quiet. The door ends with its
// portal pulling you in and the `calm` backdrop filling the screen, so the calm background shows
// at once and only the keypad fades in, as if it were waiting on the other side.
// With the fingerprint on (Settings), the door opens on the safe's fingerprint reader instead of
// the keypad: tap the green print, it scans, the safe opens. "Taper le code" switches to the
// keypad; it is shown by itself when the code is due (every 48 h) or the fingerprint was dropped.
export default function LockScreen() {
  const { status, vault, unlock, unlockWithBiometrics } = useSession();
  const [opened, setOpened] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  const [bio, setBio] = useState(false);
  const [useCode, setUseCode] = useState(false);
  const [reveal] = useState(() => new Animated.Value(0));

  useEffect(() => {
    void vault.canUseBiometrics().then(setBio);
  }, [vault]);

  // The screen has no exit fade (see _layout), so it fades out here, the green LED still lit,
  // before the app takes over; otherwise the green beat is cut off dry.
  const leave = (enter: () => void) => () =>
    Animated.timing(reveal, { toValue: 0, duration: 320, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => enter());

  async function scan() {
    const enter = await unlockWithBiometrics().catch(() => null);
    // Not allowed anymore (copy dropped by the system): the keypad takes over.
    if (!enter) setBio(await vault.canUseBiometrics());
    return enter && leave(enter);
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
      return leave(await unlock(code));
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
          {bio && !useCode ? (
            <>
              <Text style={styles.title}>BaseSecrète</Text>
              {status.kind === 'locked' ? <Text style={styles.subtitle}>{status.username}</Text> : null}
              <FingerprintPad onScan={scan} />
              <Pressable accessibilityRole="button" onPress={() => setUseCode(true)} style={styles.switch} hitSlop={8}>
                <Text style={styles.switchText}>Taper le code</Text>
              </Pressable>
            </>
          ) : (
            <>
              <CodeEntry
                title="Code BaseSecrète"
                subtitle={status.kind === 'locked' ? status.username : undefined}
                onComplete={submit}
                lockedForMs={lockedFor}
              />
              {bio ? (
                <Pressable accessibilityRole="button" onPress={() => setUseCode(false)} style={styles.switch} hitSlop={8}>
                  <Text style={styles.switchText}>Utiliser l’empreinte</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </Animated.View>
      ) : (
        <VaultDoor hint="Touche le coffre" onOpen={() => setOpened(true)} />
      )}
    </SafeAreaView>
  );
}

function beforeWipe(n: number): string {
  return `effacement de l’app après ${n} essai${n > 1 ? 's' : ''} de plus`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.title, textAlign: 'center' },
  subtitle: { ...type.dim, textAlign: 'center', marginTop: space.xs, marginBottom: space.lg },
  switch: { alignSelf: 'center', marginTop: space.lg, paddingVertical: space.sm, paddingHorizontal: space.md },
  switchText: { color: colors.accentFg, fontFamily: fonts.medium, fontSize: 16 },
});
