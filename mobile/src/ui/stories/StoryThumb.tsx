import { createContext, useContext, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { b64 } from '@/crypto';
import type { Session } from '@/services/groups';
import { jpegUri, previewUri } from '@/services/images';
import { safeToDisplay } from '@/services/jpeg';
import { steel } from '../theme';
import type { StoryMessage } from './stories';
import { useStoryImage } from './StoryPage';

/** The chat's stories, for the quotes that answer one: the group and how to find a story by id. */
export const QuotedStories = createContext<{ session: Session; groupId: string; find(id: string): StoryMessage | undefined } | null>(null);

const W = 30;
const H = 40;

/**
 * The story a reply answers, as a small photo in the quote: blurred from
 * its tiny preview at once, then itself once decrypted (shared with the
 * band's cache). Nothing once the story is gone (24 h), nor outside a chat.
 */
export function StoryThumb({ storyId }: { storyId: string }) {
  const stories = useContext(QuotedStories);
  const story = stories?.find(storyId);
  if (!stories || !story) return null;
  return <Thumb session={stories.session} groupId={stories.groupId} story={story} />;
}

function Thumb({ session, groupId, story }: { session: Session; groupId: string; story: StoryMessage }) {
  const loaded = useStoryImage(session, groupId, story, true);
  const uri = useMemo(() => {
    if (loaded.kind === 'ready') return jpegUri(loaded.jpeg);
    const p = story.story.preview;
    try {
      return p && safeToDisplay(b64.decode(p)) ? previewUri(p) : null;
    } catch {
      return null;
    }
  }, [loaded, story]);
  return (
    <View style={styles.frame}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} blurRadius={loaded.kind === 'ready' ? 0 : 4} resizeMode="cover" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: W, height: H, borderRadius: 4, overflow: 'hidden', backgroundColor: steel.plate, borderWidth: 1, borderColor: steel.edgeLight },
});
