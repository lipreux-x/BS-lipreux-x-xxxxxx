/**
 * How a conversation is drawn, chosen per group on this phone (group
 * settings), kept sealed in the local store: the server never learns it.
 *
 * - `terminal`: every message an entry of a terminal session, `❯ author [time]`, no avatars.
 * - `plates`: every message a small plate of the safe, the others' with their avatar and name.
 */
export type ChatLook = 'terminal' | 'plates';

export const CHAT_LOOKS: { label: string; value: ChatLook }[] = [
  { label: 'Terminal', value: 'terminal' },
  { label: 'Avec avatars', value: 'plates' },
];

/** What the local store holds, read back; anything else (nothing saved yet) is the terminal. */
export function chatLook(v: unknown): ChatLook {
  return v === 'plates' ? 'plates' : 'terminal';
}
