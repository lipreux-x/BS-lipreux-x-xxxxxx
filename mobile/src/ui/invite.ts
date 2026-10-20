// Invitation code format, independent of React. Pure functions, unit-tested.

/** An invitation: 16 characters, shown in groups of 4 (XXXX-XXXX-XXXX-XXXX). */
export const INVITE_LENGTH = 16;

/**
 * What the field holds after a change: dashes, spaces and anything else
 * dropped, upper case. A paste over a partly typed code (more than one
 * character added at once) keeps the last 16, so pasting a full code always
 * gives that code; typing past 16 does nothing.
 */
export function nextInvite(previous: string, text: string): string {
  const chars = text.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return chars.length - previous.length > 1 ? chars.slice(-INVITE_LENGTH) : chars.slice(0, INVITE_LENGTH);
}
