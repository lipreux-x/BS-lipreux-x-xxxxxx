import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { b64, type ImageBody } from '@/crypto';
import { ApiError } from '@/services/api';
import { loadAttachment, type Session } from '@/services/groups';
import { imageCache, jpegUri, previewUri } from '@/services/images';
import { safeToDisplay } from '@/services/jpeg';
import { LONG_PRESS_MS } from './chat/MessageBubble';
import { colors } from './theme';

const WIDTH = 240;

/** Size of the bubble from the image's aspect ratio, within sane bounds. */
export function bubbleSize(width: number, height: number) {
  return { width: WIDTH, height: Math.round(Math.min(320, Math.max(120, (WIDTH * height) / width))) };
}

type State = { kind: 'loading' } | { kind: 'ready'; jpeg: Uint8Array } | { kind: 'error'; message: string; final?: boolean };

/** The tiny preview carried in the message, if it is a sane JPEG (it comes from another member). */
function safePreview(preview: string | undefined): string | null {
  if (!preview) return null;
  try {
    return safeToDisplay(b64.decode(preview)) ? preview : null;
  } catch {
    return null;
  }
}

/**
 * An encrypted image in the chat: the blurred preview carried by the message
 * first, then the full image, downloaded and decrypted in memory. A tap
 * opens it full screen, a long press the message's actions.
 */
export function ImageBubble({
  session,
  groupId,
  body,
  onOpen,
  onLongPress,
}: {
  session: Session;
  groupId: string;
  body: ImageBody;
  onOpen(jpeg: Uint8Array): void;
  onLongPress?(): void;
}) {
  const cached = imageCache.get(body.attachmentId);
  const [state, setState] = useState<State>(cached ? { kind: 'ready', jpeg: cached } : { kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state.kind === 'ready') return;
    let live = true;
    loadAttachment(session, groupId, body)
      .then((jpeg) => {
        // Not a sane JPEG (or absurd dimensions): never handed to the decoder.
        if (!safeToDisplay(jpeg)) {
          if (live) setState({ kind: 'error', message: 'Image refusée (format invalide)', final: true });
          return;
        }
        imageCache.set(body.attachmentId, jpeg);
        if (live) setState({ kind: 'ready', jpeg });
      })
      .catch((e: unknown) => {
        if (!live) return;
        // 404: the message expired or the group was closed.
        const gone = e instanceof ApiError && e.status === 404;
        setState({ kind: 'error', message: gone ? 'Image expirée' : 'Image indisponible — touche pour réessayer' });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on retry
  }, [attempt]);

  const size = bubbleSize(body.width, body.height);
  const preview = useMemo(() => safePreview(body.preview), [body.preview]);
  // Encoding a few hundred KB to base64: once per image, not on every render.
  const uri = useMemo(() => (state.kind === 'ready' ? jpegUri(state.jpeg) : null), [state]);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Image chiffrée"
      onPress={() => {
        if (state.kind === 'ready') onOpen(state.jpeg);
        else if (state.kind === 'error' && !state.final) {
          setState({ kind: 'loading' });
          setAttempt((n) => n + 1);
        }
      }}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      style={[styles.frame, size]}
    >
      {uri ? (
        <Image source={{ uri }} style={size} resizeMode="cover" />
      ) : (
        <>
          {preview ? <Image source={{ uri: previewUri(preview) }} style={size} blurRadius={8} resizeMode="cover" /> : null}
          <View style={styles.overlay}>
            {state.kind === 'error' ? <Text style={styles.error}>{state.message}</Text> : <ActivityIndicator color={colors.text} />}
          </View>
        </>
      )}
    </Pressable>
  );
}

/** The sender's own image while it uploads: shown from the local bytes. */
export function LocalImage({ jpeg, width, height }: { jpeg: Uint8Array; width: number; height: number }) {
  const size = bubbleSize(width, height);
  const uri = useMemo(() => jpegUri(jpeg), [jpeg]);
  return (
    <View style={[styles.frame, size]}>
      <Image source={{ uri }} style={size} resizeMode="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 7, overflow: 'hidden', backgroundColor: colors.surface },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 12 },
  error: { color: colors.text, fontSize: 13, textAlign: 'center', textShadowColor: '#000', textShadowRadius: 4 },
});
