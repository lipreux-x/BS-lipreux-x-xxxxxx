import { X } from 'lucide-react-native';
import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { PreparedImage } from '@/services/groups';
import { jpegUri } from '@/services/images';
import { Key } from '../Key';
import { Led } from '../Led';
import { blade, colors, mono, space, type } from '../theme';

/** The photo just taken or picked, before it goes out: what it is, how it leaves, and the keys. */
export function ShotReview({
  image,
  label,
  note,
  action,
  again,
  onSend,
  onAgain,
  onClose,
}: {
  image: PreparedImage;
  /** On the LED's plate ("NOUVELLE STORY · 24 H"). */
  label: string;
  /** How it leaves, under the photo. */
  note: string;
  /** The hot key ("Publier la story"). */
  action: string;
  /** The key back to the camera or the library ("Reprendre"). */
  again: string;
  onSend(): void;
  onAgain(): void;
  onClose(): void;
}) {
  const uri = useMemo(() => jpegUri(image.jpeg), [image]);
  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Led state="ok" size={7} />
        <Text style={styles.label}>{label}</Text>
        <Key square size="sm" accessibilityLabel="Annuler" onPress={onClose}>
          <X size={20} color={colors.accentFg} strokeWidth={2.5} />
        </Key>
      </View>
      <Image source={{ uri }} style={styles.image} resizeMode="contain" />
      <View style={styles.bottom}>
        <Text style={[type.dim, styles.note]}>{note}</Text>
        <View style={styles.keys}>
          <Key grow size="lg" tone="cold" label={again} onPress={onAgain} />
          <Key grow size="lg" variant="hot" label={action} haptic="medium" onPress={onSend} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: blade.black },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.md, paddingVertical: space.sm },
  label: { flex: 1, fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: colors.textDim },
  image: { flex: 1, width: '100%' },
  bottom: { padding: space.md, gap: space.md },
  note: { textAlign: 'center', fontSize: 13 },
  keys: { flexDirection: 'row', gap: space.sm },
});
