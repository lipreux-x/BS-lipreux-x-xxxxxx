/*
 * Links to a group without a code (services/groups.ts createGroupLink): the
 * app's own scheme, basesecrete://invite/<code>. The code under it is the
 * link itself, for when the messaging app does not make the link tappable:
 * pasted into "Rejoindre un groupe", it does the same.
 *
 * A link tapped while the app is locked (or closed) must wait for the app
 * code: app/+native-intent.tsx keeps it here (and sends the router to the
 * join screen, which takes it if the app is open), and app/(app)/_layout.tsx
 * takes it once the app is open.
 */

/** 16 characters of the server's invite alphabet, in groups of 4 (dashes and case do not matter). */
const CODE = /^[0-9A-Za-z]{4}(-?[0-9A-Za-z]{4}){3}$/;

/** `scheme`: the app's own (the development build answers to basesecrete-dev). */
export function groupLinkUrl(code: string, scheme = 'basesecrete'): string {
  return `${scheme}://invite/${code}`;
}

/**
 * The code in a link or a pasted text: the link itself (any scheme variant, e.g.
 * the dev app's), "invite/<code>", or the bare code. Null if there is none.
 */
export function parseGroupLink(text: string): string | null {
  const t = text.trim();
  const m = /invite\/([0-9A-Za-z-]+)/.exec(t);
  const code = (m ? m[1]! : t).replace(/\s+/g, '');
  return CODE.test(code) ? code.toUpperCase() : null;
}

let pending: string | null = null;

/** A link reached the app: kept until the app is open (then `takePendingLink`). */
export function setPendingLink(code: string) {
  pending = code;
}

export function takePendingLink(): string | null {
  const code = pending;
  pending = null;
  return code;
}
