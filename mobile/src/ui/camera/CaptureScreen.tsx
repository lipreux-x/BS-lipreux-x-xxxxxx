import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PreparedImage } from '@/services/groups';
import { pickImage, prepareShot } from '@/services/images';
import { PrivacyCover } from '../PrivacyCover';
import { blade } from '../theme';
import { ShotReview } from './ShotReview';
import { Viewfinder } from './Viewfinder';

/** What the camera is opened for: a story, or a photo sent in the chat. */
export type CaptureKind = 'story' | 'photo';

const WORDING: Record<CaptureKind, { shoot: string; review: string; note: string; action: string }> = {
  story: {
    shoot: 'STORY · 24 H',
    review: 'NOUVELLE STORY · 24 H',
    note: 'Chiffrée pour les membres actuels du groupe, sans aucune métadonnée. Elle disparaît pour tous au bout de 24 h.',
    action: 'Publier la story',
  },
  photo: {
    shoot: 'PHOTO · CHIFFRÉE',
    review: 'PHOTO · CHIFFRÉE',
    note: 'Chiffrée pour les membres du groupe, sans aucune métadonnée (ni lieu, ni appareil, ni date).',
    action: 'Envoyer la photo',
  },
};

/**
 * The camera of the app, full screen over the chat: the viewfinder, then the
 * photo taken (or picked from the library) with the keys to send it or
 * shoot again. A shot never goes through another app: from the lens to the
 * re-encoding (no metadata, the camera's file deleted), then to `onSend`,
 * which encrypts it.
 */
export function CaptureScreen({ kind, onSend, onClose }: { kind: CaptureKind | null; onSend(image: PreparedImage): void; onClose(): void }) {
  // The insets of the screen, not a SafeAreaView of the modal's own (an iOS modal can measure none).
  const insets = useSafeAreaInsets();
  const [shot, setShot] = useState<{ image: PreparedImage; from: 'camera' | 'library' } | null>(null);
  const [busy, setBusy] = useState(false);

  async function take(get: () => Promise<PreparedImage | null>, from: 'camera' | 'library') {
    setBusy(true);
    try {
      const image = await get();
      if (image) setShot({ image, from });
    } catch {
      // Picker or re-encoding failed: back to the viewfinder.
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    setShot(null);
    onClose();
  };
  const words = WORDING[kind ?? 'photo'];

  return (
    <Modal visible={kind !== null} animationType="slide" onRequestClose={shot ? () => setShot(null) : close} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {shot ? (
          <ShotReview
            image={shot.image}
            label={words.review}
            note={words.note}
            action={words.action}
            again={shot.from === 'camera' ? 'Reprendre' : 'Changer'}
            onAgain={() => (shot.from === 'camera' ? setShot(null) : void take(pickImage, 'library'))}
            onClose={close}
            onSend={() => {
              setShot(null);
              onSend(shot.image);
            }}
          />
        ) : (
          <Viewfinder
            label={words.shoot}
            busy={busy}
            onShot={(s) => void take(() => prepareShot(s.uri, s.width, s.height), 'camera')}
            onLibrary={() => void take(pickImage, 'library')}
            onClose={close}
          />
        )}
      </View>
      {/* A modal is drawn above the app's own cover: it needs its own for the app switcher. */}
      <PrivacyCover />
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: blade.black },
});
