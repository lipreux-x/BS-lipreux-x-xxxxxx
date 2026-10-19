import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ImageBody } from '@/crypto';
import { ApiError } from '@/services/api';
import { loadImage, type Session } from '@/services/groups';
import { imageCache, jpegUri, previewUri } from '@/services/images';
import { colors } from './theme';

const WIDTH = 240;

/** Size of the bubble from the image's aspect ratio, within sane bounds. */
export function bubbleSize(width: number, height: number) {
  return { width: WIDTH, height: Math.round(Math.min(320, Math.max(120, (WIDTH * height) / width))) };
}

type State = { kind: 'loading' } | { kind: 'ready'; jpeg: Uint8Array } | { kind: 'error'; message: string };

/**
 * An encrypted image in the chat: the blurred preview carried by the message
 * first, then the full image, downloaded and decrypted in memory.
 */
export function ImageBubble({
  session,
  groupId,
  body,
  onOpen,
}: {
  session: Session;
  groupId: string;
  body: ImageBody;
  onOpen(jpeg: Uint8Array): void;
}) {
  const cached = imageCache.get(body.attachmentId);
  const [state, setState] = useState<State>(cached ? { kind: 'ready', jpeg: cached } : { kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state.kind === 'ready') return;
    let live = true;
    loadImage(session, groupId, body)
      .then((jpeg) => {
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
  // Encoding a few hundred KB to base64: once per image, not on every render.
  const uri = useMemo(() => (state.kind === 'ready' ? jpegUri(state.jpeg) : null), [state]);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Image chiffrée"
      onPress={() => {
        if (state.kind === 'ready') onOpen(state.jpeg);
        else if (state.kind === 'error') {
          setState({ kind: 'loading' });
          setAttempt((n) => n + 1);
        }
      }}
      style={[styles.frame, size]}
    >
      {uri ? (
        <Image source={{ uri }} style={size} resizeMode="cover" />
      ) : (
        <>
          {body.preview ? <Image source={{ uri: previewUri(body.preview) }} style={size} blurRadius={8} resizeMode="cover" /> : null}
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
  frame: { borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 12 },
  error: { color: colors.text, fontSize: 13, textAlign: 'center', textShadowColor: '#000', textShadowRadius: 4 },
});
