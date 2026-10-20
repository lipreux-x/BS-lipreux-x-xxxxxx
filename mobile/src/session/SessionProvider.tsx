import { fetch as expoFetch } from 'expo/fetch';
import * as ScreenCapture from 'expo-screen-capture';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '@/config';
import { backupKeys, createKeyBackup, deleteDeviceKey, generateIdentity, initCrypto, openKeyBackup, uptimeMs, type Identity } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { Api, type BinaryFetch } from '@/services/api';
import { biometricStore } from '@/services/biometrics';
import { ProfileCache, type GroupKeys, type Session } from '@/services/groups';
import { imageCache } from '@/services/images';
import { deleteLocalDb, openLocalStore } from '@/services/localDb';
import { registerPush, setupNotifications, unregisterPush } from '@/services/push';
import type { LocalStore } from '@/services/localStore';
import { voiceCache } from '@/services/voice';
import { secureStore } from '@/services/secureStore';
import { isFreshInstall, markInstalled } from '@/services/install';
import { sweepPlaintextCache } from '@/services/sweep';
import { prepareVault, Vault, WipedError, type UnlockedVault } from '@/services/vault';
import { systemUiOpen } from './autoLock';

/*
 * App-wide lock state. Keys only exist in memory while unlocked; locking
 * (manually, or after 5 min out of the app, SPEC §2.1.4) drops the session
 * and best-effort wipes the key bytes, and closes the local store. A group
 * closes on its own 10 min after the user left it (SPEC §2.3.3).
 *
 * Optional, per phone (Settings): screenshots and screen recording blocked
 * (FLAG_SECURE on Android, iOS 13+), and opening the app with the
 * fingerprint instead of the app code (services/biometrics.ts).
 */

/** Out of the app for this long: the app code is asked again. */
export const APP_LOCK_AFTER_MS = 5 * 60_000;
/** Out of a group for this long: its code is asked again. */
export const GROUP_LOCK_AFTER_MS = 10 * 60_000;

export type Status =
  | { kind: 'loading' }
  | { kind: 'no-account' }
  | { kind: 'locked'; username: string }
  | { kind: 'unlocked' }
  /** Startup threw (secure storage, crypto): `retry` runs it again (an interrupted wipe resumes). */
  | { kind: 'failed'; retry(): void };

export interface OpenGroup {
  keys: GroupKeys; // every version we can read; keyVersion is the one to send with
  keyVersion: number;
  name: string;
}

interface SessionContextValue {
  status: Status;
  vault: Vault;
  /** Non-null only while unlocked. */
  session: Session | null;
  profiles: ProfileCache | null;
  /** Groups unlocked with their code during this session. */
  openGroups: Map<string, OpenGroup>;
  /** Bumped when groups close on their own, so lists re-render. */
  groupsVersion: number;
  /** A screen of this group is on screen (call `leave` when it is not anymore). */
  enterGroup(groupId: string): () => void;
  /**
   * Checks the code; resolves with `enter`, which opens the app (so the UI can show success first).
   * Throws WipedError when too many wrong codes erased the phone (status is then 'no-account').
   */
  unlock(appCode: string): Promise<() => void>;
  /** Fingerprint: resolves with `enter`, or null (not allowed now, cancelled, failed): ask the code. */
  unlockWithBiometrics(): Promise<(() => void) | null>;
  /** Settings: turns fingerprint unlock on after checking the app code (WrongCodeError, LockedOutError, WipedError). */
  enableBiometrics(appCode: string): Promise<void>;
  /** Settings: blocks or allows screenshots, applied at once and at every launch. */
  setScreenshotsBlocked(blocked: boolean): Promise<void>;
  /** Creates the account on this phone; resolves with `enter`, which opens the app (so the UI can show success first). */
  register(input: { inviteCode: string; username: string; password: string; appCode: string }): Promise<() => void>;
  /** Checks username + password against the server's key backup (slow: Argon2id). */
  recover(input: { username: string; password: string }): Promise<RecoveredAccount>;
  /** Saves a recovered account on this phone under a new app code; resolves with `enter`, like `register`. */
  restore(account: RecoveredAccount, appCode: string): Promise<() => void>;
  lock(): void;
}

/** An account fetched back with its password, not saved on the phone yet. */
export interface RecoveredAccount {
  userId: string;
  username: string;
  identity: Identity;
}

/** Uptime clock when the native module is there (the wall clock can be changed by the user). */
const clock = () => uptimeMs() ?? Date.now();

const SessionContext = createContext<SessionContextValue | null>(null);
const vault = new Vault(secureStore, Date.now, uptimeMs, biometricStore);

function applyScreenshots(blocked: boolean) {
  (blocked ? ScreenCapture.preventScreenCaptureAsync() : ScreenCapture.allowScreenCaptureAsync()).catch(() => {});
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [session, setSession] = useState<Session | null>(null);
  const openGroups = useRef(new Map<string, OpenGroup>()).current;
  const [groupsVersion, setGroupsVersion] = useState(0);
  // Screens of each group on screen, and when the last one left.
  const inside = useRef(new Map<string, number>()).current;
  const leftAt = useRef(new Map<string, number>()).current;

  useEffect(() => {
    setupNotifications();
    const boot = async () => {
      sweepPlaintextCache();
      await initCrypto();
      // Reinstalled (iOS kept the Keychain): what the deleted app left is erased, not reused.
      if (isFreshInstall()) {
        if (await vault.account()) {
          await vault.wipeAll();
          await deleteDeviceKey().catch(() => {});
        }
        markInstalled();
      }
      applyScreenshots(await vault.screenshotsBlocked());
      const account = await vault.account();
      if (account && (await vault.intact())) {
        setStatus({ kind: 'locked', username: account.username });
        return;
      }
      // No account, or a wipe cut short: make sure nothing is left behind.
      if (account) await deleteDeviceKey().catch(() => {});
      await vault.wipeAll();
      await deleteLocalDb();
      setStatus({ kind: 'no-account' });
    };
    const start = () =>
      boot().catch(() =>
        setStatus({
          kind: 'failed',
          retry: () => {
            setStatus({ kind: 'loading' });
            void start();
          },
        }),
      );
    void start();
  }, []);

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const lock = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    setSession(null);
    setStatus({ kind: 'locked', username: s.account.username });
    void s.local.close();
    wipe(s.masterKey);
    wipe(s.identity.boxSecretKey);
    wipe(s.identity.signSecretKey);
    for (const g of openGroups.values()) for (const k of g.keys.values()) wipe(k);
    openGroups.clear();
    leftAt.clear();
    imageCache.clear();
    voiceCache.clear();
  }, [openGroups, leftAt]);

  /** Closes the groups left more than 10 min ago (keys and decrypted media out of memory). */
  const expireGroups = useCallback(() => {
    const now = clock();
    let closed = false;
    for (const [id, at] of leftAt) {
      if (now - at < GROUP_LOCK_AFTER_MS) continue;
      leftAt.delete(id);
      const g = openGroups.get(id);
      if (!g) continue;
      for (const k of g.keys.values()) wipe(k);
      openGroups.delete(id);
      closed = true;
    }
    if (closed) {
      imageCache.clear();
      voiceCache.clear();
      setGroupsVersion((v) => v + 1);
    }
  }, [openGroups, leftAt]);

  const enterGroup = useCallback(
    (groupId: string) => {
      expireGroups(); // left too long ago: closed before it shows again
      inside.set(groupId, (inside.get(groupId) ?? 0) + 1);
      leftAt.delete(groupId);
      return () => {
        const n = (inside.get(groupId) ?? 1) - 1;
        if (n > 0) inside.set(groupId, n);
        else {
          inside.delete(groupId);
          leftAt.set(groupId, clock());
        }
      };
    },
    [expireGroups, inside, leftAt],
  );

  // Groups left behind close while the app is in use.
  useEffect(() => {
    if (!session) return;
    const t = setInterval(expireGroups, 15_000);
    return () => clearInterval(t);
  }, [session, expireGroups]);

  // Back within 5 min: still open. Later: the app code again. Timers may not
  // run in the background, so the time away is also checked on return, on the
  // uptime clock (changing the phone's time does not shorten it). A system
  // screen opened from the app (photo picker) also counts: a phone left there
  // for 5 min locks like any other.
  useEffect(() => {
    let awayAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && awayAt === null) {
        awayAt = clock();
        // While a system screen is open the JS timer must not pull the session
        // from under it; the check on return still applies.
        if (!systemUiOpen()) timer = setTimeout(lock, APP_LOCK_AFTER_MS);
      } else if (state === 'active') {
        clearTimeout(timer);
        if (awayAt !== null && clock() - awayAt >= APP_LOCK_AFTER_MS) lock();
        else expireGroups();
        awayAt = null;
      }
    });
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [lock, expireGroups]);

  const start = useCallback((u: UnlockedVault, local: LocalStore) => {
    // expo/fetch: sends and reads raw bytes (encrypted images), which RN's fetch cannot.
    const api = new Api(API_URL, { userId: u.account.userId, identity: u.identity }, expoFetch as unknown as BinaryFetch);
    setSession({ ...u, api, vault, local });
    setStatus({ kind: 'unlocked' });
  }, []);

  /** Too many wrong codes erased the vault: the hardware key and the local database go too, back to onboarding. */
  const wiped = useCallback(async () => {
    const s = sessionRef.current;
    lock();
    await s?.local.close().catch(() => {}); // the file can only be deleted once closed
    await deleteDeviceKey().catch(() => {});
    await deleteLocalDb();
    await unregisterPush();
    setStatus({ kind: 'no-account' });
  }, [lock]);

  // Once unlocked: this phone's push token goes to the server (permission asked the first time).
  useEffect(() => {
    if (session) void registerPush(session.api);
  }, [session]);

  const unlock = useCallback(
    async (appCode: string) => {
      try {
        const u = await vault.unlock(appCode);
        const local = await openLocalStore(u.masterKey);
        return () => start(u, local);
      } catch (e) {
        if (e instanceof WipedError) await wiped();
        throw e;
      }
    },
    [start, wiped],
  );

  const unlockWithBiometrics = useCallback(async () => {
    const u = await vault.unlockWithBiometrics();
    if (!u) return null;
    const local = await openLocalStore(u.masterKey);
    return () => start(u, local);
  }, [start]);

  const enableBiometrics = useCallback(
    async (appCode: string) => {
      try {
        await vault.enableBiometrics(appCode);
      } catch (e) {
        if (e instanceof WipedError) await wiped();
        throw e;
      }
    },
    [wiped],
  );

  const setScreenshotsBlocked = useCallback(async (blocked: boolean) => {
    await vault.setScreenshotsBlocked(blocked);
    applyScreenshots(blocked);
  }, []);

  const register = useCallback(
    async ({ inviteCode, username, password, appCode }: { inviteCode: string; username: string; password: string; appCode: string }) => {
      // Keys are generated on the phone; only the public halves are sent, with
      // a copy of the secret ones sealed by the password (to sign in again).
      const identity = generateIdentity();
      // Slow local steps first (Argon2id): the invite is consumed only after them.
      const prepared = await prepareVault(identity, appCode);
      const backup = await createKeyBackup(identity, username, password);
      const { userId } = await new Api(API_URL).register(inviteCode, username, identity, backup);
      const u = await vault.commit({ userId, username }, prepared);
      const local = await openLocalStore(u.masterKey);
      return () => start(u, local);
    },
    [start],
  );

  const recover = useCallback(async ({ username, password }: { username: string; password: string }) => {
    const api = new Api(API_URL);
    const params = await api.recoverParams(username);
    const { kek, authKey } = await backupKeys(username, password, params);
    try {
      const { userId, box } = await api.recover(username, authKey);
      return { userId, username, identity: openKeyBackup(box, username, kek) };
    } finally {
      wipe(kek);
    }
  }, []);

  const restore = useCallback(
    async ({ userId, username, identity }: RecoveredAccount, appCode: string) => {
      // New device secret and master key: nothing local survives from the old phone.
      const u = await vault.commit({ userId, username }, await prepareVault(identity, appCode));
      const local = await openLocalStore(u.masterKey);
      return () => start(u, local);
    },
    [start],
  );

  const profiles = useMemo(() => (session ? new ProfileCache(session.api, vault, session.masterKey, session.local) : null), [session]);

  const value = useMemo(
    () => ({
      status,
      vault,
      session,
      profiles,
      openGroups,
      groupsVersion,
      enterGroup,
      unlock,
      unlockWithBiometrics,
      enableBiometrics,
      setScreenshotsBlocked,
      register,
      recover,
      restore,
      lock,
    }),
    [status, session, profiles, openGroups, groupsVersion, enterGroup, unlock, unlockWithBiometrics, enableBiometrics, setScreenshotsBlocked, register, recover, restore, lock],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}

/** For screens that only render while unlocked. */
export function useUnlocked() {
  const ctx = useSession();
  if (!ctx.session || !ctx.profiles) throw new Error('session is locked');
  return { ...ctx, session: ctx.session, profiles: ctx.profiles };
}
