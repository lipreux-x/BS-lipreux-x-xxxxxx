import { fetch as expoFetch } from 'expo/fetch';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '@/config';
import { backupKeys, createKeyBackup, deleteDeviceKey, generateIdentity, initCrypto, openKeyBackup, uptimeMs, type Identity } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { Api, type BinaryFetch } from '@/services/api';
import { ProfileCache, type GroupKeys, type Session } from '@/services/groups';
import { imageCache } from '@/services/images';
import { voiceCache } from '@/services/voice';
import { secureStore } from '@/services/secureStore';
import { isFreshInstall, markInstalled } from '@/services/install';
import { sweepPlaintextCache } from '@/services/sweep';
import { prepareVault, Vault } from '@/services/vault';
import { systemUiOpen } from './autoLock';

/*
 * App-wide lock state. Keys only exist in memory while unlocked; locking
 * (manually, or after 5 min out of the app, SPEC §2.1.4) drops the session
 * and best-effort wipes the key bytes. A group closes on its own 10 min after
 * the user left it (SPEC §2.3.3).
 */

/** Out of the app for this long: the app code is asked again. */
export const APP_LOCK_AFTER_MS = 5 * 60_000;
/** Out of a group for this long: its code is asked again. */
export const GROUP_LOCK_AFTER_MS = 10 * 60_000;

export type Status =
  | { kind: 'loading' }
  | { kind: 'no-account' }
  | { kind: 'locked'; username: string }
  | { kind: 'unlocked' };

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
  /** Checks the code; resolves with `enter`, which opens the app (so the UI can show success first). */
  unlock(appCode: string): Promise<() => void>;
  register(input: { inviteCode: string; username: string; password: string; appCode: string }): Promise<void>;
  /** Checks username + password against the server's key backup (slow: Argon2id). */
  recover(input: { username: string; password: string }): Promise<RecoveredAccount>;
  /** Saves a recovered account on this phone under a new app code, and opens the app. */
  restore(account: RecoveredAccount, appCode: string): Promise<void>;
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
const vault = new Vault(secureStore);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [session, setSession] = useState<Session | null>(null);
  const openGroups = useRef(new Map<string, OpenGroup>()).current;
  const [groupsVersion, setGroupsVersion] = useState(0);
  // Screens of each group on screen, and when the last one left.
  const inside = useRef(new Map<string, number>()).current;
  const leftAt = useRef(new Map<string, number>()).current;

  useEffect(() => {
    (async () => {
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
      const account = await vault.account();
      setStatus(account ? { kind: 'locked', username: account.username } : { kind: 'no-account' });
    })();
  }, []);

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const lock = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    setSession(null);
    setStatus({ kind: 'locked', username: s.account.username });
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

  const start = useCallback((u: Awaited<ReturnType<Vault['unlock']>>) => {
    // expo/fetch: sends and reads raw bytes (encrypted images), which RN's fetch cannot.
    const api = new Api(API_URL, { userId: u.account.userId, identity: u.identity }, expoFetch as unknown as BinaryFetch);
    setSession({ ...u, api, vault });
    setStatus({ kind: 'unlocked' });
  }, []);

  const unlock = useCallback(
    async (appCode: string) => {
      const u = await vault.unlock(appCode);
      return () => start(u);
    },
    [start],
  );

  const register = useCallback(
    async ({ inviteCode, username, password, appCode }: { inviteCode: string; username: string; password: string; appCode: string }) => {
      // Keys are generated on the phone; only the public halves are sent, with
      // a copy of the secret ones sealed by the password (to sign in again).
      const identity = generateIdentity();
      // Slow local steps first (Argon2id): the invite is consumed only after them.
      const prepared = await prepareVault(identity, appCode);
      const backup = await createKeyBackup(identity, username, password);
      const { userId } = await new Api(API_URL).register(inviteCode, username, identity, backup);
      start(await vault.commit({ userId, username }, prepared));
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
      start(await vault.commit({ userId, username }, await prepareVault(identity, appCode)));
    },
    [start],
  );

  const profiles = useMemo(() => (session ? new ProfileCache(session.api, vault, session.masterKey) : null), [session]);

  const value = useMemo(
    () => ({ status, vault, session, profiles, openGroups, groupsVersion, enterGroup, unlock, register, recover, restore, lock }),
    [status, session, profiles, openGroups, groupsVersion, enterGroup, unlock, register, recover, restore, lock],
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
