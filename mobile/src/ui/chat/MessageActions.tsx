import * as Clipboard from 'expo-clipboard';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, space } from '../theme';
import { QuoteBlock } from './MessageBubble';
import type { Quote } from './replies';

/**
 * Long press on a message: a panel slides up from the bottom with the
 * message quoted and its actions, as metal keys of the control panel.
 */
export function MessageActions({
  target,
  onReply,
  onClose,
}: {
  /** The pressed message: how to quote it, and its text when it has one (to copy). */
  target: { quote: Quote; text: string | null } | null;
  onReply(): void;
  onClose(): void;
}) {
  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer" />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.grip} />
        {target ? <QuoteBlock quote={target.quote} /> : null}
        <ActionKey
          label="Répondre"
          onPress={() => {
            onReply();
            onClose();
          }}
        />
        {target?.text ? (
          <ActionKey
            label="Copier le texte"
            onPress={() => {
              void Clipboard.setStringAsync(target.text!);
              onClose();
            }}
          />
        ) : null}
        <ActionKey label="Annuler" dim onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

function ActionKey({ label, onPress, dim }: { label: string; onPress(): void; dim?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
      <Text style={[styles.label, dim && { color: colors.textDim }]}>{label}</Text>
    </Pressable>
  );
}

const LIGHT_EDGE = '#4A5056';
const DARK_EDGE = '#0A0B0C';

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: '#2E2E2E',
    padding: space.md,
    gap: space.sm,
  },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.xs },
  key: {
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#24282B',
    borderWidth: 1.5,
    borderTopColor: LIGHT_EDGE,
    borderLeftColor: LIGHT_EDGE,
    borderBottomColor: DARK_EDGE,
    borderRightColor: DARK_EDGE,
  },
  pressed: {
    backgroundColor: '#1B1E20',
    borderTopColor: DARK_EDGE,
    borderLeftColor: DARK_EDGE,
    borderBottomColor: LIGHT_EDGE,
    borderRightColor: LIGHT_EDGE,
  },
  label: { color: colors.text, fontSize: 16, fontFamily: fonts.medium },
});
