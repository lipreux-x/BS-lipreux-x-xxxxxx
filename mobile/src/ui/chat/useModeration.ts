import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { NetworkError, type ReportReason } from '@/services/api';
import { block, blockedUsers, type BlockedUsers } from '@/services/blocked';
import type { ChatMessage, Session } from '@/services/groups';
import type { DialogButton } from '../Dialog';
import type { Keep } from './useKeep';

type DialogFn = (title: string, message?: string, buttons?: DialogButton[]) => void;

/**
 * Reporting a member or one of their messages, and blocking someone on this
 * phone. The report and block confirmations only come up once the action
 * sheet that opened them is gone (iOS refuses to present over a modal on its
 * way out): the `*AfterSheet` refs carry the subject across that gap, and the
 * screen calls `onActionsHidden` / `onReasonsHidden` from the sheets' onHidden.
 */
export function useModeration(session: Session, groupId: string, keep: Keep, dialog: DialogFn) {
  // "Signaler" picked in the action sheet: the reasons, once that sheet is gone.
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  // The message being reported, kept while its sheet closes: a ref for the async send,
  // and a snapshot in state for the sheet's title/note (read during render).
  const reported = useRef<ChatMessage | null>(null);
  const [reportedView, setReportedView] = useState<ChatMessage | null>(null);
  const reportAfterSheet = useRef<ChatMessage | null>(null);
  // Same for "Bloquer": its confirmation (iOS refuses to present over a modal on its way out).
  const blockAfterSheet = useRef<ChatMessage | null>(null);
  // The reason picked: sent once the reasons sheet is gone (the answer is a dialog, another modal).
  const reasonAfterSheet = useRef<ReportReason | null>(null);

  // Members blocked on this phone (long press on a message): nothing of theirs is shown, in any group.
  const [blocked, setBlocked] = useState<BlockedUsers>({});
  useFocusEffect(
    useCallback(() => {
      void keep(async (l) => setBlocked(await blockedUsers(l)));
    }, [keep]),
  );

  // The message actions sheet arms a report or a block; the subject is opened once that sheet is gone.
  const armReport = useCallback((m: ChatMessage) => void (reportAfterSheet.current = m), []);
  const armBlock = useCallback((m: ChatMessage) => void (blockAfterSheet.current = m), []);

  function pickReason(reason: ReportReason) {
    reasonAfterSheet.current = reason;
    setReporting(null);
  }

  async function sendReport(m: ChatMessage, reason: ReportReason) {
    try {
      // What is handed over is what the reporter sees: the text, decrypted here. Never a photo or a voice message.
      await session.api.report(groupId, { userId: m.senderId, messageId: m.id, reason, excerpt: m.text?.slice(0, 2000) });
      dialog('Signalement envoyé', `Merci. Il est examiné au plus vite. Tu peux aussi bloquer ${m.senderName} : tu ne verras plus rien de sa part.`, [
        { text: 'OK', style: 'cancel' },
        { text: 'Bloquer', style: 'destructive', onPress: () => void blockSender(m) },
      ]);
    } catch (e) {
      dialog('Signalement impossible', e instanceof NetworkError ? 'Pas de réseau.' : 'Réessaie plus tard.');
    }
  }

  function confirmBlock(m: ChatMessage) {
    dialog(
      `Bloquer ${m.senderName} ?`,
      `Sur ce téléphone, tu ne verras plus ses messages, ses réactions ni ses stories, dans aucun groupe. ${m.senderName} n’en est pas averti. Tu peux le débloquer dans les Réglages.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Bloquer', style: 'destructive', onPress: () => void blockSender(m) },
      ],
    );
  }

  async function blockSender(m: ChatMessage) {
    await keep(async (l) => setBlocked(await block(l, m.senderId, m.senderName)));
  }

  /** The message actions sheet is gone: open the reasons or the block confirmation it asked for. */
  function onActionsHidden() {
    if (reportAfterSheet.current) {
      const m = reportAfterSheet.current;
      reported.current = m;
      setReportedView(m);
      setReporting(m);
      reportAfterSheet.current = null;
    }
    if (blockAfterSheet.current) {
      confirmBlock(blockAfterSheet.current);
      blockAfterSheet.current = null;
    }
  }

  /** The reasons sheet is gone: send the report with the reason that was picked. */
  function onReasonsHidden() {
    const reason = reasonAfterSheet.current;
    reasonAfterSheet.current = null;
    if (reason && reported.current) void sendReport(reported.current, reason);
  }

  return {
    reporting,
    setReporting,
    reportedView,
    blocked,
    armReport,
    armBlock,
    pickReason,
    onActionsHidden,
    onReasonsHidden,
  };
}
