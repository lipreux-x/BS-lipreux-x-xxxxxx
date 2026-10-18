/*
 * Brute-force protection for local codes (SPEC §4.5): 5 free attempts, then
 * a growing delay. The state is persisted in the Secure Store by the caller,
 * so killing the app does not reset it.
 */

export interface LockoutState {
  failures: number;
  lockedUntil: number; // epoch ms, 0 when not locked
}

export const FREE_ATTEMPTS = 5;
const DELAYS_S = [30, 60, 300, 900, 3600];

export const initialLockout = (): LockoutState => ({ failures: 0, lockedUntil: 0 });

export function remainingMs(state: LockoutState, now: number): number {
  return Math.max(0, state.lockedUntil - now);
}

export function registerFailure(state: LockoutState, now: number): LockoutState {
  const failures = state.failures + 1;
  if (failures < FREE_ATTEMPTS) return { failures, lockedUntil: 0 };
  const delay = DELAYS_S[Math.min(failures - FREE_ATTEMPTS, DELAYS_S.length - 1)]!;
  return { failures, lockedUntil: now + delay * 1000 };
}

export function parseLockout(raw: string | null): LockoutState {
  try {
    const s = raw ? (JSON.parse(raw) as Partial<LockoutState>) : null;
    if (s && Number.isInteger(s.failures) && Number.isFinite(s.lockedUntil)) {
      return { failures: s.failures!, lockedUntil: s.lockedUntil! };
    }
  } catch {
    // fall through
  }
  return initialLockout();
}
