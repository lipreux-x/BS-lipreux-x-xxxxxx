import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Led } from './Led';
import { PrivacyCover } from './PrivacyCover';
import { colors, fonts, space } from './theme';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?(): void;
}

interface Shown {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

/**
 * The app's own Alert.alert: a panel of the safe, its keys as metal keys
 * (cancel grey, the action green, or red when it cannot be undone, with a
 * red LED by the title). Same arguments as Alert.alert; no buttons: one "OK".
 *
 * Returns the function and the element to render in the screen: the dialog
 * is a `<Modal>` of that screen, so it also shows over modal screens on iOS.
 * The pressed key's action runs once the dialog is closing: an action that
 * opens another dialog (an error) replaces it.
 */
export function useDialog(): [show: (title: string, message?: string, buttons?: DialogButton[]) => void, element: ReactElement] {
  // Kept while it fades out, so its content does not vanish first.
  const [shown, setShown] = useState<Shown | null>(null);
  const [visible, setVisible] = useState(false);
  const show = useCallback((title: string, message?: string, buttons?: DialogButton[]) => {
    setShown({
      title,
      message,
      buttons: buttons?.length ? buttons : [{ text: 'OK' }],
    });
    setVisible(true);
  }, []);
  const element = (
    <DialogModal
      shown={shown}
      visible={visible}
      onPick={(b) => {
        setVisible(false);
        b?.onPress?.();
      }}
    />
  );
  return [show, element];
}

function DialogModal({ shown, visible, onPick }: { shown: Shown | null; visible: boolean; onPick(b: DialogButton | null): void }) {
  const [rise] = useState(() => new Animated.Value(0));
  const destructive = !!shown?.buttons.some((b) => b.style === 'destructive');

  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    Animated.timing(rise, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
    if (destructive) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [visible, destructive, rise, shown]);

  if (!shown) return <></>;
  const cancel = shown.buttons.find((b) => b.style === 'cancel') ?? (shown.buttons.length === 1 ? shown.buttons[0]! : null);
  // Cancel on the left, as on iOS; side by side when two, stacked beyond.
  const ordered = [...shown.buttons].sort((a, b) => Number(b.style === 'cancel') - Number(a.style === 'cancel'));
  const row = ordered.length <= 2;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => onPick(cancel)}>
      <Pressable style={styles.backdrop} onPress={() => cancel && onPick(cancel)} accessibilityLabel="Fermer">
        <Animated.View
          style={[
            styles.panel,
            {
              opacity: rise,
              transform: [
                {
                  scale: rise.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1],
                  }),
                },
              ],
            },
          ]}
          // Taps on the panel stay on it, they do not reach the backdrop.
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <View key={c} style={[styles.screw, styles[c]]}>
              <View style={styles.slot} />
            </View>
          ))}
          <View style={styles.titleRow}>
            {destructive ? <Led state="red" size={9} /> : null}
            <Text style={styles.title} accessibilityRole="header">
              {shown.title}
            </Text>
          </View>
          {shown.message ? <Text style={styles.message}>{shown.message}</Text> : null}
          <View style={[styles.keys, row ? styles.keysRow : styles.keysColumn]}>
            {ordered.map((b) => (
              <Pressable
                key={b.text}
                accessibilityRole="button"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onPick(b);
                }}
                style={({ pressed }) => [
                  styles.key,
                  row && styles.keyInRow,
                  b.style === 'destructive' ? styles.danger : b.style !== 'cancel' && shown.buttons.length > 1 ? styles.go : null,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.label, b.style === 'cancel' && styles.cancelLabel]} numberOfLines={1} adjustsFontSizeToFit>
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </Pressable>
      {/* A modal is drawn above the app's own cover: it needs its own for the app switcher. */}
      <PrivacyCover />
    </Modal>
  );
}

const METAL = '#24282B';
const LIGHT_EDGE = '#4A5056';
const DARK_EDGE = '#0A0B0C';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  panel: {
    width: '100%',
    maxWidth: 360,
    padding: space.lg,
    paddingTop: space.lg + 4,
    gap: space.md,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopColor: '#2E2E2E',
    borderLeftColor: '#2E2E2E',
    borderBottomColor: '#000000',
    borderRightColor: '#000000',
    boxShadow: '0 12px 32px rgba(0,0,0,0.8)',
  },
  screw: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3A3F44',
    borderWidth: 1,
    borderColor: DARK_EDGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot: {
    width: 4,
    height: 1.5,
    backgroundColor: DARK_EDGE,
    transform: [{ rotate: '45deg' }],
  },
  tl: { top: 7, left: 7 },
  tr: { top: 7, right: 7 },
  bl: { bottom: 7, left: 7 },
  br: { bottom: 7, right: 7 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 19,
    fontFamily: fonts.semibold,
  },
  message: { color: colors.textDim, fontSize: 15, lineHeight: 21 },
  keys: { marginTop: space.xs, gap: space.sm },
  keysRow: { flexDirection: 'row' },
  keysColumn: { flexDirection: 'column' },
  key: {
    height: 50,
    paddingHorizontal: space.md,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: METAL,
    borderWidth: 1.5,
    borderTopColor: LIGHT_EDGE,
    borderLeftColor: LIGHT_EDGE,
    borderBottomColor: DARK_EDGE,
    borderRightColor: DARK_EDGE,
  },
  keyInRow: { flex: 1 },
  // The action: forest green (as "open"), or red when it destroys something.
  go: {
    backgroundColor: colors.forest,
    borderTopColor: '#3E9A58',
    borderLeftColor: '#3E9A58',
  },
  danger: {
    backgroundColor: '#7A1F22',
    borderTopColor: '#B0393D',
    borderLeftColor: '#B0393D',
  },
  // Pressed: the bevel inverts, the key looks pushed in.
  pressed: {
    opacity: 0.85,
    borderTopColor: DARK_EDGE,
    borderLeftColor: DARK_EDGE,
    borderBottomColor: LIGHT_EDGE,
    borderRightColor: LIGHT_EDGE,
    transform: [{ translateY: 1 }],
  },
  label: { color: colors.text, fontSize: 16, fontFamily: fonts.semibold },
  cancelLabel: { color: colors.accentFg, fontFamily: fonts.medium },
});
