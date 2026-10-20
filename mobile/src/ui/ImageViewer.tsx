import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { jpegUri, saveToGallery } from '@/services/images';
import { Button } from './Button';
import { PrivacyCover } from './PrivacyCover';
import { colors, space, type } from './theme';

type SaveState = 'idle' | 'saving' | 'saved' | 'denied' | 'failed';

const SAVE_MESSAGES: Partial<Record<SaveState, string>> = {
  saved: 'Enregistrée dans ta galerie',
  denied: 'Autorise l’accès aux photos dans les réglages pour enregistrer',
  failed: 'Impossible d’enregistrer l’image',
};

/** Full-screen decrypted image, with an explicit way to save it to the gallery. */
export function ImageViewer({ jpeg, onClose }: { jpeg: Uint8Array | null; onClose(): void }) {
  const [save, setSave] = useState<SaveState>('idle');
  const uri = useMemo(() => (jpeg ? jpegUri(jpeg) : null), [jpeg]);

  function close() {
    setSave('idle');
    onClose();
  }

  return (
    <Modal visible={jpeg !== null} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <SafeAreaView style={styles.screen}>
        <View style={styles.top}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" hitSlop={12} onPress={close}>
            <Text style={styles.close}>Fermer</Text>
          </Pressable>
        </View>
        {uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" /> : null}
        <View style={styles.bottom}>
          {SAVE_MESSAGES[save] ? <Text style={[type.dim, styles.message]}>{SAVE_MESSAGES[save]}</Text> : null}
          <Button
            title="Enregistrer dans la galerie"
            variant="ghost"
            busy={save === 'saving'}
            disabled={save === 'saved'}
            onPress={() => {
              if (!jpeg) return;
              setSave('saving');
              saveToGallery(jpeg)
                .then(setSave)
                .catch(() => setSave('failed'));
            }}
          />
          <Text style={[type.dim, styles.message, { fontSize: 12 }]}>Une fois dans la galerie, l’image n’est plus chiffrée.</Text>
        </View>
      </SafeAreaView>
      {/* A modal is drawn above the app's own cover: it needs its own for the app switcher. */}
      <PrivacyCover />
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', justifyContent: 'flex-end', padding: space.md },
  close: { color: colors.accentFg, fontSize: 16 },
  image: { flex: 1, width: '100%' },
  bottom: { padding: space.md, gap: space.sm },
  message: { textAlign: 'center' },
});
