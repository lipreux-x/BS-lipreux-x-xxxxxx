import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { systemUiOpen } from '@/session/autoLock';
import { Logo } from './Logo';
import { colors } from './theme';

/**
 * Hides the screen as soon as the app leaves the foreground, so the recent
 * apps view does not show the conversation. iOS: a heavy blur when the app
 * switcher opens ('inactive'), taken in its snapshot. Android 13+ shows no
 * snapshot at all (plugins/withHiddenRecents.js); older versions get this
 * cover, opaque because Android blurs only with a native blur target.
 *
 * iOS draws modals (stack screens with `presentation: 'modal'`, RN `<Modal>`)
 * above the root view, so each of them renders its own cover too.
 *
 * A system prompt over the app (Touch ID, permissions) only makes it
 * 'inactive': the app stays visible under it, so the fingerprint pad keeps
 * showing its scan. Leaving the app ('background') always covers it.
 *
 * The cover shows the blade alone, never the app's name.
 */
export function PrivacyCover() {
  const [hidden, setHidden] = useState(AppState.currentState !== 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) =>
      setHidden(state === 'background' || (state === 'inactive' && !systemUiOpen())),
    );
    return () => sub.remove();
  }, []);
  if (!hidden) return null;
  const mark = <Logo width={120} />;
  return Platform.OS === 'ios' ? (
    <BlurView intensity={100} tint="dark" style={styles.cover} pointerEvents="none">
      {mark}
    </BlurView>
  ) : (
    <View style={[styles.cover, styles.opaque]} pointerEvents="none">
      {mark}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  opaque: { backgroundColor: colors.bg },
});
