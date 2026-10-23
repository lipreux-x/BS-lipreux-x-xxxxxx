import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ReactionId } from '@/crypto';
import { copySensitive } from '@/services/clipboard';
import { PrivacyCover } from '../PrivacyCover';
import { colors, fonts, space, steel } from '../theme';
import { QuoteBlock } from './MessageBubble';
import { ReactionKeys } from './ReactionKeys';
import type { Quote } from './replies';

// Android: longest wait for the window focus to come back after the panel closes.
const HIDDEN_FALLBACK_MS = 600;

/**
 * Long press on a message: a panel slides up from the bottom with the
 * message quoted, the five reaction keys (mine lit) and its actions, as
 * metal keys of the control panel.
 */
export function MessageActions({
  target,
  reaction,
  order,
  onReact,
  onReorder,
  onReply,
  onClose,
  onHidden,
}: {
  /** The pressed message: how to quote it, and its text when it has one (to copy). */
  target: { quote: Quote; text: string | null } | null;
  /** My reaction to it, if any. */
  reaction?: ReactionId | null;
  /** The five keys in this phone's order. */
  order?: ReactionId[];
  onReact?(id: ReactionId): void;
  /** A key dragged to a new place (long press, then slide). */
  onReorder?(order: ReactionId[]): void;
  onReply(): void;
  onClose(): void;
  /** The panel is gone (see `ActionSheet`): the keyboard can come up for a reply. */
  onHidden?(): void;
}) {
  return (
    <ActionSheet visible={target !== null} onClose={onClose} onHidden={onHidden}>
      {target ? <QuoteBlock quote={target.quote} /> : null}
      {onReact && order ? (
        <ReactionKeys
          order={order}
          current={reaction ?? null}
          onPick={(id) => {
            onReact(id);
            onClose();
          }}
          onReorder={(next) => onReorder?.(next)}
        />
      ) : null}
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
            void copySensitive(target.text!);
            onClose();
          }}
        />
      ) : null}
      <ActionKey label="Annuler" dim onPress={onClose} />
    </ActionSheet>
  );
}

/**
 * Panel sliding up from the bottom, closed by tapping outside.
 *
 * `onHidden` runs once it is gone and the screen under it has the focus
 * back: a text field focused before that gets no keyboard (Android refuses
 * it to a window without focus). iOS says so (`onDismiss`); Android does
 * not, but the app's window gets the focus back from the panel's.
 */
export function ActionSheet({
  visible,
  onClose,
  onHidden,
  children,
}: {
  visible: boolean;
  onClose(): void;
  onHidden?(): void;
  children: ReactNode;
}) {
  const hidden = useRef(onHidden);
  useEffect(() => {
    hidden.current = onHidden;
  }, [onHidden]);
  const wasVisible = useRef(visible);
  useEffect(() => {
    const closed = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!closed || Platform.OS === 'ios') return;
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      hidden.current?.();
    };
    const sub = AppState.addEventListener('focus', fire);
    const timer = setTimeout(fire, HIDDEN_FALLBACK_MS);
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={() => hidden.current?.()}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer" />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.grip} />
        {children}
      </SafeAreaView>
      {/* A modal is drawn above the app's own cover: it needs its own for the app switcher. */}
      <PrivacyCover />
    </Modal>
  );
}

export function ActionKey({ label, onPress, dim, danger }: { label: string; onPress(): void; dim?: boolean; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
      <Text style={[styles.label, dim && { color: colors.textDim }, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const LIGHT_EDGE = steel.edgeLight;
const DARK_EDGE = steel.edgeDark;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: steel.panelEdge,
    padding: space.md,
    gap: space.sm,
  },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.xs },
  key: {
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: steel.key,
    borderWidth: 1.5,
    borderTopColor: LIGHT_EDGE,
    borderLeftColor: LIGHT_EDGE,
    borderBottomColor: DARK_EDGE,
    borderRightColor: DARK_EDGE,
  },
  pressed: {
    backgroundColor: steel.keyPressed,
    borderTopColor: DARK_EDGE,
    borderLeftColor: DARK_EDGE,
    borderBottomColor: LIGHT_EDGE,
    borderRightColor: LIGHT_EDGE,
  },
  label: { color: colors.text, fontSize: 16, fontFamily: fonts.medium },
});
