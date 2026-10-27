import { STORY_TTL_SECONDS, type StoryBody } from '@/crypto';

/*
 * Stories layout, independent of React: which stories are still alive, in
 * what order the band shows them, and where it opens. Pure functions,
 * unit-tested.
 */

/** A story message, as the chat knows it. */
export interface StoryMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  mine: boolean;
  story: StoryBody;
  createdAt: string;
  expiresAt: string | null;
}

/** When a story disappears: the server's date, or 24 h after it was sent if the server gave none. */
export function storyExpiry(m: Pick<StoryMessage, 'createdAt' | 'expiresAt'>): Date {
  return new Date(m.expiresAt ? Date.parse(m.expiresAt) : Date.parse(m.createdAt) + STORY_TTL_SECONDS * 1000);
}

export const storyAlive = (m: Pick<StoryMessage, 'createdAt' | 'expiresAt'>, now: Date) => storyExpiry(m) > now;

/**
 * The band, left to right: oldest first, so a new story arrives at the end
 * and nothing moves under the finger (watching one does not reorder them
 * either). Expired stories are left out.
 */
export function bandStories(stories: StoryMessage[], now: Date): StoryMessage[] {
  return stories.filter((s) => storyAlive(s, now)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Someone else's story not watched yet (mine never count as new). */
export const isNew = (s: StoryMessage, seen: ReadonlySet<string>) => !s.mine && !seen.has(s.id);

/** Where the band opens: the oldest story not watched yet, or the newest when all were. */
export function openingIndex(stories: StoryMessage[], seen: ReadonlySet<string>): number {
  const i = stories.findIndex((s) => isNew(s, seen));
  return i >= 0 ? i : Math.max(0, stories.length - 1);
}

/** Watched ids worth keeping: those of stories still around (the rest can never show again). */
export function pruneSeen(seen: ReadonlySet<string>, stories: StoryMessage[]): string[] {
  const alive = new Set(stories.map((s) => s.id));
  return [...seen].filter((id) => alive.has(id));
}

/**
 * The rail's line, folded or open. What the band is doing comes first
 * (failed, sending, just published); then, folded, my own story is named
 * ("LA TIENNE", with "+ 2" for the others when none is new) before the new
 * ones, so that a story just sent stays visibly up.
 */
export function railLabel(s: {
  failed: boolean;
  sending: boolean;
  published: boolean;
  open: boolean;
  index: number;
  count: number;
  /** Someone else's stories not watched yet. */
  fresh: number;
  /** My own stories still up. */
  mine: number;
}): string {
  const parts = ['STORIES · 24 H'];
  if (s.failed) parts.push('ÉCHEC');
  else if (s.sending) parts.push('ENVOI…');
  else if (s.published) parts.push('PUBLIÉE');
  else if (s.open && s.count) parts.push(`${s.index + 1} / ${s.count}`);
  else {
    const others = s.count - s.mine;
    if (s.mine) {
      const own = s.mine > 1 ? 'LES TIENNES' : 'LA TIENNE';
      parts.push(others && !s.fresh ? `${own} + ${others}` : own);
    }
    if (s.fresh) parts.push(`${s.fresh} NOUVELLE${s.fresh > 1 ? 'S' : ''}`);
    else if (!s.mine && s.count) parts.push(String(s.count));
  }
  return parts.join(' · ');
}

/**
 * Where a tap on the big story leads: the left half goes back, the right
 * half forward. Past the last one the band folds ('close'); before the first
 * one, nothing (null).
 */
export function storyTap(side: 'left' | 'right', index: number, count: number): number | 'close' | null {
  if (side === 'left') return index > 0 ? index - 1 : null;
  return index < count - 1 ? index + 1 : 'close';
}

/**
 * The whole photo in the shutter: as wide as the shutter, or (a very tall
 * photo in a short area) as tall as the area allows and narrower. The
 * shutter comes down by exactly this height.
 */
export function fitStory(photo: { width: number; height: number }, areaWidth: number, maxHeight: number): { width: number; height: number } {
  if (!(photo.width > 0) || !(photo.height > 0)) return { width: areaWidth, height: maxHeight };
  const scale = Math.min(areaWidth / photo.width, maxHeight / photo.height);
  return { width: Math.round(photo.width * scale), height: Math.round(photo.height * scale) };
}
