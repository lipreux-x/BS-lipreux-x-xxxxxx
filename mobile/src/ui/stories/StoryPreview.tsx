import { useMemo } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PreparedImage } from '@/services/groups';
import { jpegUri } from '@/services/images';
import { Button } from '../Button';
import { Led } from '../Led';
import { PrivacyCover } from '../PrivacyCover';
import { colors, mono, space, type } from '../theme';

/** The photo just taken or picked, before it goes out as a story. */
export function StoryPreview({ image, onPublish, onCancel }: { image: PreparedImage | null; onPublish(): void; onCancel(): void }) {
  const uri = useMemo(() => (image ? jpegUri(image.jpeg) : null), [image]);
  return (
    <Modal visible={image !== null} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <SafeAreaView style={styles.screen}>
        <View style={styles.top}>
          <Led state="green" size={7} />
          <Text style={styles.label}>NOUVELLE STORY · 24 H</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Annuler" hitSlop={12} onPress={onCancel}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        {uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" /> : <View style={styles.image} />}
        <View style={styles.bottom}>
          <Text style={[type.dim, styles.note]}>
            Chiffrée pour les membres actuels du groupe, sans aucune métadonnée. Elle disparaît pour tous au bout de 24 h.
          </Text>
          <Button title="Publier la story" onPress={onPublish} />
          <Button title="Annuler" variant="ghost" onPress={onCancel} />
        </View>
      </SafeAreaView>
      {/* A modal is drawn above the app's own cover: it needs its own for the app switcher. */}
      <PrivacyCover />
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.md, paddingVertical: 12 },
  label: { flex: 1, fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: colors.textDim },
  close: { color: colors.accentFg, fontSize: 22, paddingHorizontal: 4 },
  image: { flex: 1, width: '100%' },
  bottom: { padding: space.md, gap: space.sm },
  note: { textAlign: 'center', fontSize: 13 },
});
