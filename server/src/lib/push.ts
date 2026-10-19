import { and, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { groupMembers, pushTokens } from '../db/schema';

/*
 * Push notifications (SPEC §4.7): a generic line, never a name, a sender or
 * a word of the message. The only thing the push services (Expo, Google,
 * Apple) learn is that a phone got "a message", and the group id (a random
 * UUID) the app opens once the user has typed every code.
 *
 * At most one notification per phone every THROTTLE_SECONDS: a busy group
 * does not ring nonstop, and the timing says less.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** "message reçu", written backwards. */
export const PUSH_BODY = 'uçer egassem';
const THROTTLE_SECONDS = 30;
const TIMEOUT_MS = 3000;

export const PUSH_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;

/** Rings the other active members of the group (best effort: a failure never fails the send). */
export async function notifyGroup(groupId: string, senderId: string): Promise<void> {
  try {
    const due = await db
      .update(pushTokens)
      .set({ lastPushAt: sql`now()` })
      .where(
        and(
          inArray(
            pushTokens.userId,
            db
              .select({ id: groupMembers.userId })
              .from(groupMembers)
              .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active'), ne(groupMembers.userId, senderId))),
          ),
          or(isNull(pushTokens.lastPushAt), lt(pushTokens.lastPushAt, sql`now() - make_interval(secs => ${THROTTLE_SECONDS})`)),
        ),
      )
      .returning({ token: pushTokens.token });
    if (!due.length) return;
    await send(due.map((t) => t.token), groupId);
  } catch {
    // The message is stored either way; the phone sees it at the next opening.
  }
}

async function send(tokens: string[], groupId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(
        tokens.map((to) => ({ to, body: PUSH_BODY, sound: 'default', priority: 'high', channelId: 'messages', data: { groupId } })),
      ),
    });
    if (!res.ok) return;
    // Tickets come back in the same order: forget the phones that uninstalled the app.
    const { data } = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    const gone = tokens.filter((_, i) => data?.[i]?.details?.error === 'DeviceNotRegistered');
    if (gone.length) await db.delete(pushTokens).where(inArray(pushTokens.token, gone));
  } finally {
    clearTimeout(timer);
  }
}
