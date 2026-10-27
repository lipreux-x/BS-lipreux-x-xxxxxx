import { and, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { groupMembers, profiles, pushTokens } from '../db/schema';

/*
 * Push notifications (SPEC §4.7). The server knows no group name and no
 * message, so what it can say is thin; the phone fills in the rest.
 *
 * - Android: a silent push (no title, no body), carrying the group id (a
 *   random UUID) and the kind of event. The app wakes in the background
 *   (mobile services/push.ts) and shows its own notification: the group's
 *   name as the phone knows it, one notification per group, replaced as
 *   messages pile up. Google relays the id and the kind, nothing else.
 * - iOS (and phones registered without a platform): a visible push with a
 *   plain line (PUSH_BODY) and no group name; Apple replaces the one already
 *   shown for the same group and kind (collapseId).
 *
 * "message": at most one per phone every THROTTLE_SECONDS, and none while
 * the person has the app open (profiles.awake_until, renewed by
 * PUT /me/presence): the open app shows the message itself. The other
 * kinds (the group waits for this person) are rare and each one matters:
 * sent every time, app open or not.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const THROTTLE_SECONDS = 30;
const TIMEOUT_MS = 3000;
/** How long one PUT /me/presence counts (the app renews it every 30 s). */
export const PRESENCE_SECONDS = 75;

export type PushKind = 'message' | 'join_request' | 'approved' | 'member_left' | 'code_changed' | 'direct';
export type ActionKind = Exclude<PushKind, 'message'>;

export const PUSH_TITLE = 'BaseSecrète';
/** The visible line (iOS); Android phones write their own with the group's name. */
export const PUSH_BODY: Record<PushKind, string> = {
  message: 'Nouveau message',
  join_request: 'Quelqu’un demande à entrer dans un groupe',
  approved: 'Demande acceptée : entre le code du groupe',
  member_left: 'Un membre est parti : la clé du groupe est à renouveler',
  code_changed: 'Le code du groupe a changé : entre le nouveau',
  direct: 'Nouvelle discussion privée : choisis son code',
};

export const PUSH_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;

/** Rings the other active members of the group who are not in the app (best effort: a failure never fails the send). */
export async function notifyGroup(groupId: string, senderId: string): Promise<void> {
  await ring(groupId, 'message', members(groupId, { except: senderId, asleep: true }), { throttle: true });
}

/**
 * Tells the people the group now waits for (best effort). `who`: the active
 * admins, the active members, or given user ids; `except` is the one whose own action caused it.
 */
export async function notifyAction(groupId: string, kind: ActionKind, who: 'admins' | 'members' | string[], except?: string): Promise<void> {
  const recipients = Array.isArray(who) ? who.filter((id) => id !== except) : members(groupId, { except, role: who === 'admins' ? 'admin' : undefined });
  if (Array.isArray(recipients) && recipients.length === 0) return;
  await ring(groupId, kind, recipients, { throttle: false });
}

function members(groupId: string, { except, role, asleep }: { except?: string; role?: 'admin'; asleep?: boolean }) {
  return db
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(profiles, eq(profiles.id, groupMembers.userId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.status, 'active'),
        role ? eq(groupMembers.role, role) : undefined,
        except ? ne(groupMembers.userId, except) : undefined,
        asleep ? or(isNull(profiles.awakeUntil), lt(profiles.awakeUntil, sql`now()`)) : undefined,
      ),
    );
}

async function ring(groupId: string, kind: PushKind, recipients: ReturnType<typeof members> | string[], { throttle }: { throttle: boolean }) {
  try {
    const due = await db
      .update(pushTokens)
      .set({ lastPushAt: sql`now()` })
      .where(
        and(
          inArray(pushTokens.userId, recipients),
          throttle ? or(isNull(pushTokens.lastPushAt), lt(pushTokens.lastPushAt, sql`now() - make_interval(secs => ${THROTTLE_SECONDS})`)) : undefined,
        ),
      )
      .returning({ token: pushTokens.token, platform: pushTokens.platform });
    if (!due.length) return;
    await send(due, kind, groupId);
  } catch {
    // Whatever happened is stored either way; the phone sees it at the next opening.
  }
}

type Target = { token: string; platform: 'ios' | 'android' | null };

async function send(targets: Target[], kind: PushKind, groupId: string) {
  const data = { groupId, kind };
  const payload = targets.map(({ token, platform }) =>
    platform === 'android'
      ? // Silent: the app shows the notification itself (high priority: delivered at once, even dozing).
        { to: token, data, priority: 'high' }
      : {
          to: token,
          title: PUSH_TITLE,
          body: PUSH_BODY[kind],
          sound: 'default',
          priority: 'high',
          channelId: 'messages',
          collapseId: `${kind}:${groupId}`,
          data,
        },
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    // Tickets come back in the same order: forget the phones that uninstalled the app.
    const { data: tickets } = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    const gone = targets.filter((_, i) => tickets?.[i]?.details?.error === 'DeviceNotRegistered').map((t) => t.token);
    if (gone.length) await db.delete(pushTokens).where(inArray(pushTokens.token, gone));
  } finally {
    clearTimeout(timer);
  }
}
