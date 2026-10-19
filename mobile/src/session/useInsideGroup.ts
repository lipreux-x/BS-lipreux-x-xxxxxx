import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useSession } from './SessionProvider';

/**
 * For the screens of an open group (chat, settings, code): while one is on
 * screen the group stays open; 10 min after the last one left, it closes.
 * `onEnter` runs each time the screen shows again.
 */
export function useInsideGroup(groupId: string, onEnter?: () => void) {
  const { enterGroup } = useSession();
  useFocusEffect(
    useCallback(() => {
      const leave = enterGroup(groupId);
      onEnter?.();
      return leave;
    }, [enterGroup, groupId, onEnter]),
  );
}
