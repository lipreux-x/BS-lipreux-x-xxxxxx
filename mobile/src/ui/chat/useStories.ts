import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import type { ReactionId } from '@/crypto';
import type { ChatMessage } from '@/services/groups';
import { records } from '@/services/localStore';
import type { Pending } from '@/services/outbox';
import { bandStories, pruneSeen, storyReactions, type StoryMessage } from '@/ui/stories/stories';
import type { Keep } from './useKeep';

type Story = ChatMessage & { story: NonNullable<ChatMessage['story']> };

/**
 * The stories of a chat: the ones still alive (in the band's order), those
 * already watched (kept on the phone), whether the band is down and on which
 * story it opens, and what a story's keys do (react, answer). `band` is what
 * StoriesBand takes, but for what the chat does with its "+" key.
 */
export function useStories({
  groupId,
  shown,
  pending,
  keep,
  react,
  reply,
  onOpenChange,
}: {
  groupId: string;
  shown: ChatMessage[];
  pending: Pending[];
  keep: Keep;
  react(m: ChatMessage, id: ReactionId): void;
  /** Answer this message (the composer's reply strip). */
  reply(m: ChatMessage): void;
  /** The band came down, or went back up. */
  onOpenChange?(open: boolean): void;
}) {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const seenLoaded = useRef(false);
  const [open, setOpen] = useState(false);
  // The story whose quote was tapped: the band opens on it.
  const [focus, setFocus] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // The stories watched before, loaded once from the phone.
  useEffect(() => {
    void keep(async (l) => {
      const watched = await l.getRecord<{ seen: string[] }>(records.stories(groupId));
      if (watched?.seen.length) setSeen((prev) => new Set([...prev, ...watched.seen]));
      seenLoaded.current = true;
    });
  }, [keep, groupId]);
  const onSeen = useCallback((id: string) => {
    setSeen((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  }, []);

  const messages = useMemo(() => shown.filter((m): m is Story => !!m.story), [shown]);
  const stories = useMemo(() => bandStories(messages as StoryMessage[], now), [messages, now]);
  // What was watched is kept, for the stories still around.
  useEffect(() => {
    if (seenLoaded.current) void keep((l) => l.setRecord(records.stories(groupId), { seen: pruneSeen(seen, messages as StoryMessage[]) }));
  }, [seen, messages, keep, groupId]);

  const pull = useCallback((down: boolean) => {
    if (down) Keyboard.dismiss();
    else setFocus(null);
    setOpen(down);
  }, []);
  /** The quote of a story, tapped: the band comes down on it. */
  const show = useCallback(
    (id: string) => {
      setFocus(id);
      pull(true);
    },
    [pull],
  );
  const find = useCallback((id: string) => messages.find((s) => s.id === id), [messages]);
  const onReact = useCallback(
    (id: string, reaction: ReactionId) => {
      const m = find(id);
      if (m) react(m, reaction);
    },
    [find, react],
  );
  /** Typing over a story answers it. */
  const onReply = useCallback(
    (id: string) => {
      const m = find(id);
      if (m) reply(m);
    },
    [find, reply],
  );

  // Who reacted to which story: shown in the conversation, like a reply.
  const reactions = useMemo(() => storyReactions(shown, new Set(messages.map((m) => m.id))), [shown, messages]);

  const failed = pending.find((p) => p.kind === 'story' && p.failed);
  return {
    /** Every story message, alive or not: replies quote them. */
    messages,
    reactions,
    failed,
    show,
    band: {
      stories,
      seen,
      open,
      sending: pending.some((p) => p.kind === 'story' && !p.failed),
      failed: !!failed,
      now,
      focus,
      onOpenChange: pull,
      onSeen,
      onReact,
      onReply,
    },
  };
}
