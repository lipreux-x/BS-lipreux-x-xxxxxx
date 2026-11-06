import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, Session } from '@/services/groups';
import { colorsOf, saveColors, savedColors, type GroupColors } from '@/services/groupColors';
import type { Keep } from './useKeep';

/**
 * Each member's colour in this group (chosen in its settings): the saved list
 * first, then the server's, fetched again on coming back (from the settings,
 * where mine may have changed) and when someone new writes.
 */
export function useMemberColors(session: Session, groupId: string, keep: Keep, messages: ChatMessage[]): GroupColors | null {
  const [memberColors, setMemberColors] = useState<GroupColors | null>(null);
  const colorsAsked = useRef(new Set<string>());
  const refreshColors = useCallback(() => {
    session.api
      .members(groupId)
      .then(({ members }) => {
        const fresh = colorsOf(members);
        if (!fresh) return;
        setMemberColors(fresh);
        void keep((l) => saveColors(l, groupId, fresh));
      })
      .catch((e: unknown) => {
        if (__DEV__) console.warn('[colors] refresh failed', e);
      });
  }, [session, groupId, keep]);
  useEffect(() => {
    void keep(async (l) => {
      const saved = await savedColors(l, groupId);
      if (saved) setMemberColors((c) => c ?? saved);
    });
  }, [keep, groupId]);
  useFocusEffect(refreshColors);
  useEffect(() => {
    if (!memberColors) return;
    const unknown = messages.filter((m) => !Object.hasOwn(memberColors, m.senderId) && !colorsAsked.current.has(m.senderId));
    if (!unknown.length) return;
    for (const m of unknown) colorsAsked.current.add(m.senderId);
    refreshColors();
  }, [messages, memberColors, refreshColors]);
  return memberColors;
}
