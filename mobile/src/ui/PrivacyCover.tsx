import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { colors } from './theme';
import { Wordmark } from './Wordmark';

/**
 * Hides the screen as soon as the app leaves the foreground, so the recent
 * apps view does not show the conversation. iOS: a heavy blur when the app
 * switcher opens ('inactive'), taken in its snapshot. Android 13+ shows no
 * snapshot at all (plugins/withHiddenRecents.js); older versions get this
 * cover, opaque because Android blurs only with a native blur target.
 */
export function PrivacyCover() {
  const [hidden, setHidden] = useState(AppState.currentState !== 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setHidden(state !== 'active'));
    return () => sub.remove();
  }, []);
  if (!hidden) return null;
  const mark = <Wordmark />;
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
