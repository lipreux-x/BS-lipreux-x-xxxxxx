import { useCallback, useEffect, useState } from 'react';
import { wipe } from '@/crypto/encoding';
import type { OpenGroup } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { forgetGroup, type Session } from '@/services/groups';
import { dayLabel, dayRange } from './timeline';
import type { DialogButton } from '../Dialog';

type DialogFn = (title: string, message?: string, buttons?: DialogButton[]) => void;

/**
 * The self-destruct countdown (and the end of the group when its date comes),
 * and the admin's "erase a span of history for everyone". `expiresAt` comes
 * from the live sync; `destroy` drops the keys and everything the phone kept.
 */
export function useEphemeral({
  expiresAt,
  resync,
  reset,
  session,
  groupId,
  openGroups,
  current,
  dialog,
}: {
  expiresAt: Date | null;
  resync(opts?: { full?: boolean }): Promise<void>;
  reset(): void;
  session: Session;
  groupId: string;
  openGroups: Map<string, OpenGroup>;
  current: React.RefObject<OpenGroup>;
  dialog: DialogFn;
}) {
  const [now, setNow] = useState(() => new Date());
  const [destroyed, setDestroyed] = useState(false);
  // Day long-pressed by an admin: the erase menu is open for it.
  const [eraseDay, setEraseDay] = useState<Date | null>(null);

  /** Self-destructed: keys out of memory and off the phone, nothing left to show. */
  const destroy = useCallback(() => {
    const open = openGroups.get(groupId);
    if (open) for (const k of open.keys.values()) wipe(k);
    openGroups.delete(groupId);
    void forgetGroup(session, groupId, current.current.keyVersion);
    reset();
    setDestroyed(true);
  }, [openGroups, groupId, session, reset]);

  // Countdown refresh, and the end of the group when its date comes.
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const t = new Date();
      setNow(t);
      if (t >= expiresAt) destroy();
    };
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [expiresAt, destroy]);

  async function erase(day: Date, days: number) {
    const { from, to } = dayRange(day, days);
    try {
      await session.api.eraseMessages(groupId, from, to);
      await resync({ full: true });
    } catch (e) {
      dialog(
        'Impossible d’effacer',
        e instanceof NetworkError
          ? 'Pas de réseau.'
          : e instanceof ApiError && e.code === 'admin_only'
            ? 'Seul un admin peut effacer des messages.'
            : 'Réessaie plus tard.',
      );
    }
  }

  function confirmErase(day: Date, days: number) {
    const { from } = dayRange(day, days);
    const today = new Date();
    const span =
      days === 1
        ? `du ${dayLabel(day, today).toLowerCase()}`
        : `du ${dayLabel(from, today).toLowerCase()} au ${dayLabel(day, today).toLowerCase()}`;
    dialog(`Effacer les messages ${span} ?`, 'Les messages, les photos et les vocaux de cette période seront effacés pour tous les membres. C’est définitif.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Effacer', style: 'destructive', onPress: () => void erase(day, days) },
    ]);
  }

  return { now, destroyed, eraseDay, setEraseDay, confirmErase };
}
