import { useCallback } from 'react';
import type { Session } from '@/services/groups';
import type { LocalStore } from '@/services/localStore';

/**
 * The phone's copy of the history (SPEC §5.2): shown first, readable offline.
 * Best effort: it only serves offline reading, the server keeps the history
 * (and the store refuses writes once the app is locked).
 */
export function useKeep(session: Session) {
  return useCallback((fn: (l: LocalStore) => Promise<unknown>) => fn(session.local).catch(() => {}), [session]);
}

export type Keep = ReturnType<typeof useKeep>;
