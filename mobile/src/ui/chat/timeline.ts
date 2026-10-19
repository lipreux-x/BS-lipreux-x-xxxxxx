/*
 * Chat layout, independent of React: day separators, runs of messages from
 * the same sender (author shown once, squared corner on the last one) and
 * time labels. Pure functions, unit-tested.
 */

const RUN_GAP_MS = 5 * 60_000;
const DAYS = ['DIM.', 'LUN.', 'MAR.', 'MER.', 'JEU.', 'VEN.', 'SAM.'];
const MONTHS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];

const pad = (n: number) => String(n).padStart(2, '0');

/** "14:05", local time. */
export function timeLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "AUJOURD'HUI", "HIER", "LUN. 19 OCT." (year added when not the current one). */
export function dayLabel(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) return 'AUJOURD’HUI';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return 'HIER';
  const label = `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? label : `${label} ${date.getFullYear()}`;
}

export interface TimelineMessage {
  key: string;
  senderId: string;
  at: Date;
}

export type TimelineItem<M extends TimelineMessage> =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: M; first: boolean; last: boolean };

/**
 * Messages in chronological order -> items in chronological order, with a
 * separator before each new day. A run is consecutive messages from the same
 * sender on the same day, less than 5 minutes apart.
 */
export function buildTimeline<M extends TimelineMessage>(messages: M[], now: Date): TimelineItem<M>[] {
  const items: TimelineItem<M>[] = [];
  const continues = (a: M | undefined, b: M | undefined) =>
    !!a && !!b && a.senderId === b.senderId && dayKey(a.at) === dayKey(b.at) && b.at.getTime() - a.at.getTime() < RUN_GAP_MS;
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    if (!prev || dayKey(prev.at) !== dayKey(m.at)) items.push({ kind: 'day', key: `day-${dayKey(m.at)}`, label: dayLabel(m.at, now) });
    items.push({ kind: 'message', key: m.key, message: m, first: !continues(prev, m), last: !continues(m, messages[i + 1]) });
  });
  return items;
}
