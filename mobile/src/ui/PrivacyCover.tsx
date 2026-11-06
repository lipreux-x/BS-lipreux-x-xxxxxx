import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { systemUiOpen } from '@/session/autoLock';
import { Logo } from './Logo';

/**
 * Hides the screen as soon as the app leaves the foreground, so the recent
 * apps view does not show the conversation: an opaque steel-grey plate (iOS
 * takes it in its snapshot when the app switcher opens, 'inactive'), with
 * nothing of the screen showing through. Android 13+ shows no snapshot at
 * all (plugins/withHiddenRecents.js); older versions get this cover too.
 *
 * iOS draws modals (stack screens with `presentation: 'modal'`, RN `<Modal>`)
 * above the root view, so each of them renders its own cover too.
 *
 * A system prompt over the app (Touch ID, permissions) only makes it
 * 'inactive': the app stays visible under it, so the fingerprint pad keeps
 * showing its scan. Leaving the app ('background') always covers it.
 *
 * On the plate, the blade alone, never the app's name.
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
  return (
    <View style={styles.cover} pointerEvents="none">
      <Logo width={120} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2F35',
    zIndex: 1000,
    elevation: 1000,
  },
});
