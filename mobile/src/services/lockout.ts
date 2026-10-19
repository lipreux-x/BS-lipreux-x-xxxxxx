/*
 * Brute-force protection for local codes (SPEC §4.5): 5 free attempts, then
 * a growing delay. The state is persisted in the Secure Store by the caller,
 * so killing the app does not reset it.
 *
 * The delay is measured on the phone's uptime clock (native module), which
 * changing the date and time does not move: setting the clock forward skips
 * nothing, and a reboot restarts the wait rather than ending it. Without the
 * native module (tests), the wall clock is used.
 */

export interface LockoutState {
  failures: number;
  lockedUntil: number; // wall-clock epoch ms, 0 when not locked
  /** Uptime (ms) when the current wait started, and its length. */
  upAt?: number;
  waitMs?: number;
}

export const FREE_ATTEMPTS = 5;
const DELAYS_S = [30, 60, 300, 900, 3600];

export const initialLockout = (): LockoutState => ({ failures: 0, lockedUntil: 0 });

/** Time left, and (after a reboot) the state to persist so the wait restarts from now. */
export function remainingMs(state: LockoutState, now: number, uptime: number | null = null): number {
  return checkLockout(state, now, uptime).remaining;
}

export function checkLockout(state: LockoutState, now: number, uptime: number | null): { remaining: number; rebased?: LockoutState } {
  if (uptime !== null && state.upAt !== undefined && state.waitMs !== undefined) {
    const elapsed = uptime - state.upAt;
    // The uptime went back: the phone rebooted. The wait starts over.
    if (elapsed < 0) return { remaining: state.waitMs, rebased: { ...state, upAt: uptime } };
    return { remaining: Math.max(0, state.waitMs - elapsed) };
  }
  return { remaining: Math.max(0, state.lockedUntil - now) };
}

export function registerFailure(state: LockoutState, now: number, uptime: number | null = null): LockoutState {
  const failures = state.failures + 1;
  if (failures < FREE_ATTEMPTS) return { failures, lockedUntil: 0 };
  const delay = DELAYS_S[Math.min(failures - FREE_ATTEMPTS, DELAYS_S.length - 1)]! * 1000;
  return { failures, lockedUntil: now + delay, ...(uptime !== null && { upAt: uptime, waitMs: delay }) };
}

export function parseLockout(raw: string | null): LockoutState {
  try {
    const s = raw ? (JSON.parse(raw) as Partial<LockoutState>) : null;
    if (s && Number.isInteger(s.failures) && Number.isFinite(s.lockedUntil)) {
      const mono = Number.isFinite(s.upAt) && Number.isFinite(s.waitMs);
      return { failures: s.failures!, lockedUntil: s.lockedUntil!, ...(mono && { upAt: s.upAt!, waitMs: s.waitMs! }) };
    }
  } catch {
    // fall through
  }
  // Unreadable: treat as the worst case seen so far rather than a fresh start.
  return raw ? { failures: FREE_ATTEMPTS, lockedUntil: 0 } : initialLockout();
}
