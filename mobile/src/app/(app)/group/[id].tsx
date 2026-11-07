import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { wipe } from '@/crypto/encoding';
import { useUnlocked, type OpenGroup } from '@/session/SessionProvider';
import { useInsideGroup } from '@/session/useInsideGroup';
import { SwipeBack } from '@/ui/SwipeBack';
import { Chat } from '@/ui/chat/Chat';
import { GroupUnlock } from '@/ui/chat/GroupUnlock';
import { colors } from '@/ui/theme';

const REVEAL_MS = 260;

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { openGroups, closeGroup } = useUnlocked();
  const [open, setOpen] = useState<OpenGroup | undefined>(openGroups.get(id));
  // Opened by its code: the code entry stays on top (blue LED, the blade turning)
  // while the chat decrypts its history under it, and goes once the messages are
  // there. Already open: the chat shows at once, with its own wait over the messages.
  const [covered, setCovered] = useState(!open);
  const [coverOpacity] = useState(() => new Animated.Value(1));
  // Each locking brings a fresh code entry (the last one may still hold its success).
  const [locks, setLocks] = useState(0);
  // The stories pulled down: a drag to the right goes back to the previous one, not out of the group.
  const [storiesOpen, setStoriesOpen] = useState(false);
  const update = useCallback(
    (g: OpenGroup) => {
      openGroups.set(id, g);
      setOpen(g);
    },
    [openGroups, id],
  );
  const lock = useCallback(() => {
    coverOpacity.setValue(1);
    setLocks((n) => n + 1);
    setCovered(true);
    setOpen(undefined);
  }, [coverOpacity]);
  // Closed while away (10 min out of it): its code again.
  useInsideGroup(
    id,
    useCallback(() => {
      const g = openGroups.get(id);
      if (g) setOpen(g);
      else lock();
    }, [openGroups, id, lock]),
  );

  // The admin changed the code (and the key moved on under it): the group locks, its new code opens it.
  const relock = useCallback(() => {
    const g = openGroups.get(id);
    if (g) for (const k of g.keys.values()) wipe(k);
    openGroups.delete(id);
    lock();
  }, [openGroups, id, lock]);

  const reveal = useCallback(() => {
    Animated.timing(coverOpacity, { toValue: 0, duration: REVEAL_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => finished && setCovered(false),
    );
  }, [coverOpacity]);

  // Dragged to the right anywhere on it, the conversation goes back to the list
  // and the group closes at once (its code again next time), the quick way out.
  // The header's back arrow keeps it open for 10 min.
  const swipeShut = useCallback(() => {
    closeGroup(id);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [closeGroup, id]);

  return (
    <SwipeBack onBack={swipeShut} off={storiesOpen}>
      <View style={styles.screen}>
        {open ? (
          <Chat
            groupId={id}
            group={open}
            onUpdate={update}
            onLocked={relock}
            onReady={covered ? reveal : undefined}
            titled={!covered}
            onStoriesOpen={setStoriesOpen}
          />
        ) : null}
        {covered ? (
          <Animated.View key={locks} style={[StyleSheet.absoluteFill, styles.cover, { opacity: coverOpacity }]} pointerEvents={open ? 'none' : 'auto'}>
            <GroupUnlock groupId={id} onOpen={update} />
          </Animated.View>
        ) : null}
      </View>
    </SwipeBack>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  cover: { backgroundColor: colors.bg },
});
