import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { Platform } from 'react-native';
import { whileSystemUi } from '@/session/autoLock';
import type { Api } from './api';

/*
 * Push notifications (SPEC §4.7). The server sends one fixed line, "message
 * reçu" written backwards, with no sender, group name or content; its data
 * only carries the group id. Tapping it opens the app on the lock screen as
 * usual: app code (or fingerprint), then the group's code, then straight
 * into that group (see `pendingGroup`, consumed by app/(app)/_layout.tsx).
 *
 * Needs a native build (not Expo Go); on Android, Firebase credentials for
 * the Expo push service as well. Every step here is best effort: without
 * them the app works, it just does not ring.
 */

const CHANNEL = 'messages';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let configured = false;

/** Once at launch: how notifications show while the app is open, the Android channel, taps. */
export function setupNotifications() {
  if (configured) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Messages',
        importance: AndroidImportance.HIGH,
        // Shown on the lock screen like any other; its text is generic anyway.
        lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
        vibrationPattern: [0, 200, 120, 200],
      }).catch(() => {});
    }
    Notifications.addNotificationResponseReceivedListener((r) => openFrom(r));
    // Launched by a tap while the app was closed.
    void Notifications.getLastNotificationResponseAsync()
      .then((r) => r && openFrom(r))
      .catch(() => {});
  } catch {
    // Module missing (Expo Go): no notifications.
  }
}

// ---- tap -> group ------------------------------------------------------------------

let pending: string | null = null;
const listeners = new Set<() => void>();

function openFrom(r: Notifications.NotificationResponse) {
  const id = r.notification.request.content.data?.groupId;
  if (typeof id !== 'string' || !UUID.test(id)) return;
  pending = id;
  for (const l of listeners) l();
  void Notifications.clearLastNotificationResponseAsync().catch(() => {});
}

/** The group a tapped notification asked for, once (null if none). */
export function takePendingGroup(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export function onPendingGroup(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- token -------------------------------------------------------------------------

/** 'blocked': refused, and the system will not ask again (only its settings can allow them). */
export type PushStatus = 'on' | 'denied' | 'blocked' | 'unavailable';

/**
 * Asks for the permission if never asked, and gives this phone's token to
 * the server. `ask: false` only registers when already allowed.
 */
export async function registerPush(api: Api, { ask = true } = {}): Promise<PushStatus> {
  try {
    let { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask && canAskAgain) {
      ({ status, canAskAgain } = await whileSystemUi(() => Notifications.requestPermissionsAsync()));
    }
    if (status !== 'granted') return canAskAgain ? 'denied' : 'blocked';
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.setPushToken(token);
    return 'on';
  } catch {
    return 'unavailable';
  }
}

/** Wipe: this phone stops receiving anything (the server forgets the token at the next send). */
export async function unregisterPush() {
  await Notifications.unregisterForNotificationsAsync().catch(() => {});
}
