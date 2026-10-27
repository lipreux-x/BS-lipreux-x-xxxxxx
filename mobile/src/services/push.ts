import Constants from 'expo-constants';
import type { NotificationResponse, NotificationTaskPayload } from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { whileSystemUi } from '@/session/autoLock';
import type { Api } from './api';
import { secureStore } from './secureStore';

/*
 * Push notifications (SPEC §4.7). The server knows no group name and no
 * message: a push only carries the group id and the kind of event
 * (`message`, or what the group waits for: `join_request`, `approved`,
 * `member_left`, `code_changed`).
 *
 * - Android: the push is silent. This module wakes in the background (a
 *   TaskManager task, run even with the app closed) and shows the
 *   notification itself: the group's name as this phone knows it, one
 *   notification per group that "Nouveaux messages" replaces as they pile
 *   up, instead of one line per message. The names come from the group list
 *   (services/groups.ts) and live in the Keystore, readable without the app
 *   code: they must be, the app is locked when a push comes in.
 * - iOS: the push is visible, with a plain line and no group name (the app
 *   cannot rewrite it there).
 *
 * While the app is open, "message" pushes are not shown at all (the server
 * does not even send them, see PUT /me/presence); the other kinds show as a
 * banner. Opening a conversation takes its notification down.
 *
 * Tapping one opens the app on the lock screen as usual: app code (or
 * fingerprint), then the group's code, then straight into that group (see
 * `pendingGroup`, consumed by app/(app)/_layout.tsx).
 *
 * Needs a native build (not Expo Go); on Android, Firebase credentials for
 * the Expo push service as well. Every step here is best effort: without
 * them the app works, it just does not ring.
 */

/**
 * expo-notifications and expo-task-manager, or null on a build without their
 * native modules (a development client older than them, Expo Go, Jest): an
 * import at the top would throw before anything is drawn, so they are
 * required here, and the app then simply does not ring.
 */
function optional<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications = optional(() => require('expo-notifications') as typeof import('expo-notifications'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TaskManager = optional(() => require('expo-task-manager') as typeof import('expo-task-manager'));

const CHANNEL = 'messages';
const TASK = 'bs-push';
/** Keystore record: { names: group id -> name, counts: group id -> messages since the last opening }. */
const STORE_KEY = 'bs.notif';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 60;

export type PushKind = 'message' | 'join_request' | 'approved' | 'member_left' | 'code_changed' | 'direct';
const KINDS: readonly PushKind[] = ['message', 'join_request', 'approved', 'member_left', 'code_changed', 'direct'];
const isKind = (k: unknown): k is PushKind => typeof k === 'string' && (KINDS as readonly string[]).includes(k);

/** What the group waits for, under its name. */
const ACTION_BODY: Record<Exclude<PushKind, 'message'>, string> = {
  join_request: 'Quelqu’un demande à entrer',
  approved: 'Demande acceptée : entre le code du groupe',
  member_left: 'Un membre est parti : clé à renouveler',
  code_changed: 'Le code a changé : entre le nouveau',
  direct: 'Nouvelle discussion privée : choisis ton code',
};

interface Push {
  groupId: string;
  kind: PushKind;
}

// ---- background task (Android) ----------------------------------------------------

// Module scope, as expo-task-manager requires: the bundle is loaded headless
// just to run this when a silent push arrives with the app closed.
try {
  TaskManager?.defineTask<NotificationTaskPayload>(TASK, async ({ data, error }) => {
    if (error || !data || 'actionIdentifier' in data) return; // a tap, handled by openFrom
    const push = parsePush(data.data);
    if (!push) return;
    // The app is on screen: the conversation shows the message, the banner handler the rest.
    if (AppState.currentState === 'active') return;
    await show(push);
  });
} catch {
  // A task already defined (a reload): nothing to do.
}

/** The push's payload, as FCM hands it over (JSON in `dataString` or `body`, or already an object). */
function parsePush(data: Record<string, unknown> | undefined): Push | null {
  let raw: unknown = data;
  const packed = data?.dataString ?? data?.body;
  if (typeof packed === 'string') {
    try {
      raw = JSON.parse(packed);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const { groupId, kind } = raw as { groupId?: unknown; kind?: unknown };
  if (typeof groupId !== 'string' || !UUID.test(groupId) || !isKind(kind)) return null;
  return { groupId, kind };
}

/** Shows (or replaces) the group's notification. */
async function show({ groupId, kind }: Push) {
  const store = await readStore();
  const name = store.names[groupId];
  let body: string;
  if (kind === 'message') {
    const n = (store.counts[groupId] ?? 0) + 1;
    store.counts[groupId] = n;
    await writeStore(store);
    body = n > 1 ? 'Nouveaux messages' : 'Nouveau message';
  } else {
    body = ACTION_BODY[kind];
  }
  await Notifications?.scheduleNotificationAsync({
    identifier: notificationId(groupId, kind),
    content: { title: name ?? 'BaseSecrète', body: name ? body : `${body} · groupe verrouillé`, data: { groupId, kind }, sound: 'default' },
    trigger: null,
  });
}

/** One notification per group for messages, one per group and kind for the rest: a new one replaces it. */
const notificationId = (groupId: string, kind: PushKind) => `${kind}:${groupId}`;

interface NotifStore {
  names: Record<string, string>;
  counts: Record<string, number>;
}

async function readStore(): Promise<NotifStore> {
  try {
    const raw = await secureStore.get(STORE_KEY);
    const s = raw ? (JSON.parse(raw) as Partial<NotifStore>) : null;
    return { names: s?.names ?? {}, counts: s?.counts ?? {} };
  } catch {
    return { names: {}, counts: {} };
  }
}

async function writeStore(s: NotifStore) {
  try {
    await secureStore.set(STORE_KEY, JSON.stringify(s));
  } catch {
    // Keystore unavailable: the next notification just has no name.
  }
}

/** The group names to show on notifications (the whole list: a group gone from it is forgotten). */
export async function setNotificationNames(names: Record<string, string | null>) {
  const store = await readStore();
  const next: NotifStore = { names: {}, counts: {} };
  for (const [id, name] of Object.entries(names)) {
    if (name) next.names[id] = name.slice(0, MAX_NAME);
    if (store.counts[id]) next.counts[id] = store.counts[id]!;
  }
  await writeStore(next);
}

/** The conversation is on screen: its notification goes, its count restarts. */
export async function clearGroupNotification(groupId: string) {
  const store = await readStore();
  if (store.counts[groupId]) {
    delete store.counts[groupId];
    await writeStore(store);
  }
  if (!Notifications) return;
  await Promise.all(KINDS.map((k) => Notifications.dismissNotificationAsync(notificationId(groupId, k)).catch(() => {})));
}

// ---- setup -------------------------------------------------------------------------

let configured = false;

/** Once at launch: how notifications show while the app is open, the Android channel, taps. */
export function setupNotifications() {
  if (configured || !Notifications) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      // App open: a message is on screen already (or one tap away), only what the group waits for is worth a banner.
      handleNotification: async (n) => {
        const banner = n.request.content.data?.kind !== 'message' && !!n.request.content.body;
        return { shouldShowBanner: banner, shouldShowList: banner, shouldPlaySound: false, shouldSetBadge: false };
      },
    });
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        // Shown on the lock screen like any other: the group's name and "Nouveau message", never a message.
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        vibrationPattern: [0, 200, 120, 200],
      }).catch(() => {});
      // Silent pushes wake the task above, app closed or not.
      void Notifications.registerTaskAsync(TASK).catch(() => {});
    }
    Notifications.addNotificationResponseReceivedListener((r) => openFrom(r));
    // Launched by a tap while the app was closed.
    void Notifications.getLastNotificationResponseAsync()
      .then((r) => r && openFrom(r))
      .catch(() => {});
  } catch {
    // A step the build cannot do: no notifications.
  }
}

// ---- tap -> group ------------------------------------------------------------------

let pending: string | null = null;
const listeners = new Set<() => void>();

function openFrom(r: NotificationResponse) {
  const id = r.notification.request.content.data?.groupId;
  if (typeof id !== 'string' || !UUID.test(id)) return;
  pending = id;
  for (const l of listeners) l();
  void Notifications?.clearLastNotificationResponseAsync().catch(() => {});
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
  if (!Notifications) return 'unavailable';
  try {
    let { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask && canAskAgain) {
      ({ status, canAskAgain } = await whileSystemUi(() => Notifications.requestPermissionsAsync()));
    }
    if (status !== 'granted') return canAskAgain ? 'denied' : 'blocked';
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.setPushToken(token, Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null);
    return 'on';
  } catch {
    return 'unavailable';
  }
}

/** Wipe: this phone stops receiving anything (the server forgets the token at the next send), and forgets the names. */
export async function unregisterPush() {
  await Notifications?.unregisterForNotificationsAsync().catch(() => {});
  await Notifications?.dismissAllNotificationsAsync().catch(() => {});
  await secureStore.delete(STORE_KEY).catch(() => {});
}
