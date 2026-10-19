import { fetch as expoFetch } from 'expo/fetch';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '@/config';
import { generateIdentity, initCrypto } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { Api, type BinaryFetch } from '@/services/api';
import { ProfileCache, type GroupKeys, type Session } from '@/services/groups';
import { imageCache } from '@/services/images';
import { secureStore } from '@/services/secureStore';
import { prepareVault, Vault } from '@/services/vault';
import { systemUiOpen } from './autoLock';

/*
 * App-wide lock state. Keys only exist in memory while unlocked; locking
 * (manually or when the app goes to the background, SPEC §2.1.4) drops the
 * session and best-effort wipes the key bytes.
 */

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
  /** Checks the code; resolves with `enter`, which opens the app (so the UI can show success first). */
  unlock(appCode: string): Promise<() => void>;
  register(input: { inviteCode: string; username: string; appCode: string }): Promise<void>;
  lock(): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const vault = new Vault(secureStore);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [session, setSession] = useState<Session | null>(null);
  const openGroups = useRef(new Map<string, OpenGroup>()).current;

  useEffect(() => {
    (async () => {
      await initCrypto();
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
    imageCache.clear();
  }, [openGroups]);

  // Re-lock as soon as the app leaves the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !systemUiOpen()) lock();
    });
    return () => sub.remove();
  }, [lock]);

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
    async ({ inviteCode, username, appCode }: { inviteCode: string; username: string; appCode: string }) => {
      // Keys are generated on the phone; only the public halves are sent.
      const identity = generateIdentity();
      // Slow local step first (Argon2id): the invite is consumed only after it.
      const prepared = prepareVault(identity, appCode);
      const { userId } = await new Api(API_URL).register(inviteCode, username, identity);
      start(await vault.commit({ userId, username }, prepared));
    },
    [start],
  );

  const profiles = useMemo(() => (session ? new ProfileCache(session.api) : null), [session]);

  const value = useMemo(
    () => ({ status, vault, session, profiles, openGroups, unlock, register, lock }),
    [status, session, profiles, openGroups, unlock, register, lock],
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
