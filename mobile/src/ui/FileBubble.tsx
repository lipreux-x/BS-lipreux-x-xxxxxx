import { FileText } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FileBody } from '@/crypto';
import { ApiError } from '@/services/api';
import { loadAttachment, type PreparedFile, type Session } from '@/services/groups';
import { fileExt, fileSizeLabel } from './chat/files';
import { LONG_PRESS_MS } from './chat/MessageBubble';
import { colors, fonts, mono } from './theme';

/**
 * An encrypted document in the chat: its name, type and size on a metal
 * plate. A tap downloads and decrypts it, then `onOpen` hands it to another
 * app; a long press opens the message's actions.
 */
export function FileBubble({
  session,
  groupId,
  body,
  onOpen,
  onLongPress,
}: {
  session: Session;
  groupId: string;
  body: FileBody;
  onOpen(bytes: Uint8Array, body: FileBody): Promise<void>;
  onLongPress?(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onOpen(await loadAttachment(session, groupId, body), body);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'Fichier supprimé' : 'Indisponible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Document ${body.name}, ${fileSizeLabel(body.size)}. Ouvrir`}
      onPress={() => void open()}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <FileCard name={body.name} size={body.size} busy={busy} note={error} />
    </Pressable>
  );
}

/** A document still on its way out. */
export function LocalFile({ file }: { file: PreparedFile }) {
  return (
    <View style={styles.card}>
      <FileCard name={file.name} size={file.bytes.length} />
    </View>
  );
}

function FileCard({ name, size, busy, note }: { name: string; size: number; busy?: boolean; note?: string | null }) {
  const ext = fileExt(name);
  return (
    <>
      <View style={styles.badge}>
        {busy ? <ActivityIndicator color={colors.text} size="small" /> : <FileText size={22} color={colors.text} strokeWidth={1.75} />}
        {ext && !busy ? <Text style={styles.ext}>{ext.slice(0, 4)}</Text> : null}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={[styles.meta, note ? styles.note : null]} numberOfLines={1}>
          {note ?? `${fileSizeLabel(size)} · chiffré`}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // A dark plate, lit on its upper edge like the keypad keys.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 220,
    maxWidth: 280,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#1D2023',
    borderWidth: 1,
    borderTopColor: '#4A5056',
    borderLeftColor: '#4A5056',
    borderBottomColor: '#0A0B0C',
    borderRightColor: '#0A0B0C',
  },
  pressed: { opacity: 0.8 },
  badge: { width: 44, height: 52, borderRadius: 6, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  ext: { color: colors.textDim, fontFamily: mono, fontSize: 9, letterSpacing: 1 },
  info: { flex: 1, gap: 2 },
  name: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  meta: { color: colors.textDim, fontFamily: mono, fontSize: 10, letterSpacing: 0.5 },
  note: { color: colors.danger },
});
