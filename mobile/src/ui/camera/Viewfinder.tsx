import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Images, RefreshCcw, X, Zap, ZapOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { whileSystemUi } from '@/session/autoLock';
import { Key } from '../Key';
import { Led } from '../Led';
import { blade, bevel, colors, glow, hotKey, mono, neon, space, steel, type } from '../theme';

/** The viewfinder's corner marks: length of a stroke, its thickness, its inset. */
const MARK = 22;
const MARK_W = 2;
const MARK_IN = 14;
const SHUTTER = 76;

/**
 * The app's own camera, inside the app: what the lens sees in a 3:4 window
 * (the photo's own shape, so what shows is what goes out), framed by the
 * sky marks of a security camera. Steel keys around it: close, flash,
 * the library, the other lens; in the middle the red shutter, a hot key
 * set in a steel ring. The shot comes back as a file in the app's cache,
 * which the re-encoding deletes once it holds the bytes (`onShot`).
 */
export function Viewfinder({
  label,
  busy,
  onShot,
  onLibrary,
  onClose,
}: {
  /** What is being shot, on the LED's plate ("STORY · 24 H"). */
  label: string;
  /** The shot is being re-encoded: the shutter waits. */
  busy: boolean;
  onShot(shot: { uri: string; width: number; height: number }): void;
  onLibrary(): void;
  onClose(): void;
}) {
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState(false);
  const [ready, setReady] = useState(false);
  const [shooting, setShooting] = useState(false);

  // Asked once per opening (the system's own prompt): refused, the window says how to allow it.
  const asked = useRef(false);
  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain || asked.current) return;
    asked.current = true;
    void whileSystemUi(requestPermission);
  }, [permission, requestPermission]);

  async function shoot() {
    if (!camera.current || !ready || shooting || busy) return;
    setShooting(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // The click as the phone's own camera makes it: on iOS the system's, silent with the mute switch;
      // on Android the camera would play its own at full volume even on silent, so the tap of the phone
      // (which follows its vibration setting) stands in for it.
      const shot = await camera.current.takePictureAsync({ quality: 1, exif: false, shutterSound: Platform.OS === 'ios' });
      if (shot) onShot(shot);
    } catch {
      // The lens went away under us (app sent to the background): nothing taken.
    } finally {
      setShooting(false);
    }
  }

  const denied = permission && !permission.granted && !permission.canAskAgain;
  const height = Math.round((width * 4) / 3);
  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Key square size="sm" accessibilityLabel="Fermer" onPress={onClose}>
          <X size={20} color={colors.accentFg} strokeWidth={2.5} />
        </Key>
        <View style={styles.plate}>
          <Led state="ok" size={7} />
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Key
          square
          size="sm"
          accessibilityLabel={flash ? 'Flash activé' : 'Flash désactivé'}
          onPress={() => setFlash((f) => !f)}
        >
          {flash ? <Zap size={18} color={blade.skyLight} strokeWidth={2.25} /> : <ZapOff size={18} color={colors.textDim} strokeWidth={2.25} />}
        </Key>
      </View>

      <View style={[styles.window, { width, height }]}>
        {permission?.granted ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing={facing}
            flash={flash ? 'on' : 'off'}
            mirror={facing === 'front'}
            animateShutter={false}
            onCameraReady={() => setReady(true)}
          />
        ) : (
          <View style={styles.blocked}>
            <Text style={type.heading}>{denied ? 'Appareil photo désactivé' : 'Appareil photo'}</Text>
            <Text style={[type.dim, styles.center]}>
              {denied
                ? 'Autorise l’appareil photo dans les réglages du téléphone, ou choisis une photo dans ta galerie.'
                : 'Autorise l’appareil photo pour prendre la photo ici, dans l’app.'}
            </Text>
            {denied ? (
              <Key size="sm" tone="cold" label="Ouvrir les réglages" onPress={() => void Linking.openSettings()} />
            ) : permission ? (
              <Key size="sm" tone="cold" label="Autoriser" onPress={() => void whileSystemUi(requestPermission)} />
            ) : null}
          </View>
        )}
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <View key={c} pointerEvents="none" style={[styles.mark, MARKS[c]]} />
        ))}
      </View>

      <View style={styles.bottom}>
        <Text style={styles.note}>RESTE DANS L’APP · CHIFFRÉE AVANT L’ENVOI</Text>
        <View style={styles.controls}>
          <Key square size="lg" accessibilityLabel="Choisir dans la galerie" onPress={onLibrary}>
            <Images size={22} color={colors.accentFg} strokeWidth={2.25} />
          </Key>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Prendre la photo"
            disabled={!permission?.granted || !ready || shooting || busy}
            onPress={() => void shoot()}
            style={styles.ring}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.shutter,
                  { backgroundColor: pressed ? hotKey.facePressed : hotKey.face, ...bevel(hotKey.edgeLight, hotKey.edgeDark, pressed) },
                  !pressed && neon.box(glow.hot, 14),
                ]}
              >
                {shooting || busy ? <ActivityIndicator color={colors.text} /> : null}
              </View>
            )}
          </Pressable>
          <Key
            square
            size="lg"
            accessibilityLabel={facing === 'back' ? 'Passer à la caméra avant' : 'Passer à la caméra arrière'}
            disabled={!permission?.granted}
            onPress={() => {
              setReady(false);
              setFacing((f) => (f === 'back' ? 'front' : 'back'));
            }}
          >
            <RefreshCcw size={22} color={colors.accentFg} strokeWidth={2.25} />
          </Key>
        </View>
      </View>
    </View>
  );
}

const corner = (top: boolean, left: boolean) => ({
  [top ? 'top' : 'bottom']: MARK_IN,
  [left ? 'left' : 'right']: MARK_IN,
  [top ? 'borderTopWidth' : 'borderBottomWidth']: MARK_W,
  [left ? 'borderLeftWidth' : 'borderRightWidth']: MARK_W,
});
const MARKS = { tl: corner(true, true), tr: corner(true, false), bl: corner(false, true), br: corner(false, false) };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: blade.black, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  plate: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: colors.textDim },
  window: { overflow: 'hidden', backgroundColor: steel.plate },
  blocked: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  center: { textAlign: 'center' },
  mark: { position: 'absolute', width: MARK, height: MARK, borderColor: blade.sky, opacity: 0.85 },
  bottom: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md },
  note: { fontFamily: mono, fontSize: 9, letterSpacing: 1.2, color: colors.textDim, textAlign: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // The steel ring the red shutter is set in.
  ring: {
    width: SHUTTER + 14,
    height: SHUTTER + 14,
    borderRadius: (SHUTTER + 14) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: steel.key,
    borderWidth: 1.5,
    ...bevel(steel.edgeLight, steel.edgeDark),
  },
  shutter: { width: SHUTTER, height: SHUTTER, borderRadius: SHUTTER / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
