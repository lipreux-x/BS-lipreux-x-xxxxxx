import type { Member } from './api';
import { records, type LocalStore } from './localStore';

/**
 * Each member's color in one group (ui/accountColors.tsx), chosen by each of
 * them in the group's settings: their name, avatar and messages there, for
 * every member. The server holds it beside the membership; the phone keeps the
 * last list (sealed in its local store) for the first frame and offline.
 */
export type GroupColors = Readonly<Record<string, string | null>>;

/** From the server's member list; null from an older server, which sends none (the profile colors then stay). */
export function colorsOf(members: readonly Member[]): GroupColors | null {
  if (members.length && members.every((m) => m.color === undefined)) return null;
  return Object.fromEntries(members.map((m) => [m.userId, m.color ?? null]));
}

/** Someone's color in the group: theirs there; someone no longer in it keeps their profile's (the one color of older apps). */
export function colorIn(colors: GroupColors | null, userId: string, profileColor: string | null): string | null {
  return colors && Object.hasOwn(colors, userId) ? (colors[userId] ?? null) : profileColor;
}

export async function savedColors(local: LocalStore, groupId: string): Promise<GroupColors | null> {
  return (await local.getRecord<{ colors: GroupColors }>(records.colors(groupId)))?.colors ?? null;
}

export async function saveColors(local: LocalStore, groupId: string, colors: GroupColors): Promise<void> {
  await local.setRecord(records.colors(groupId), { colors });
}
