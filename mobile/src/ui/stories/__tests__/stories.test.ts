import { bandStories, fitStory, isNew, openingIndex, pruneSeen, railLabel, storyAlive, storyExpiry, storyTap, type StoryMessage } from '../stories';

const now = new Date('2026-10-20T15:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

const body = {
  kind: 'story' as const,
  attachmentId: '9d3c1f00-0000-4000-8000-0000000000bb',
  fileKey: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
  mime: 'image/jpeg' as const,
  width: 10,
  height: 10,
  size: 100,
};

function story(id: string, sender: string, ago: number, extra: Partial<StoryMessage> = {}): StoryMessage {
  return {
    id,
    senderId: sender,
    senderName: sender,
    senderAvatar: null,
    mine: sender === 'me',
    story: body,
    createdAt: hoursAgo(ago),
    expiresAt: hoursAgo(ago - 24),
    ...extra,
  };
}

describe('story lifetime', () => {
  it('uses the server date, or 24 h after sending without one', () => {
    expect(storyExpiry(story('a', 'x', 2)).toISOString()).toBe(hoursAgo(-22));
    expect(storyExpiry(story('a', 'x', 2, { expiresAt: null })).toISOString()).toBe(hoursAgo(-22));
    expect(storyAlive(story('a', 'x', 23), now)).toBe(true);
    expect(storyAlive(story('a', 'x', 25), now)).toBe(false);
  });
});

describe('band', () => {
  const stories = [
    story('b2', 'bob', 1),
    story('a1', 'alice', 5),
    story('b1', 'bob', 3),
    story('m1', 'me', 10),
    story('c1', 'carol', 2),
    story('old', 'dave', 30), // expired
  ];

  it('shows the stories oldest first and drops expired ones', () => {
    expect(bandStories(stories, now).map((s) => s.id)).toEqual(['m1', 'a1', 'b1', 'c1', 'b2']);
  });

  it('opens at the oldest story not watched yet, mine never counting as new', () => {
    const band = bandStories(stories, now);
    expect(openingIndex(band, new Set())).toBe(1);
    expect(openingIndex(band, new Set(['a1', 'b1']))).toBe(3);
    expect(isNew(band[0]!, new Set())).toBe(false);
  });

  it('opens at the newest story when all were watched, at 0 when there is none', () => {
    const band = bandStories(stories, now);
    expect(openingIndex(band, new Set(['a1', 'b1', 'c1', 'b2']))).toBe(4);
    expect(openingIndex([], new Set())).toBe(0);
  });

  it('forgets watched ids of stories that are gone', () => {
    expect(pruneSeen(new Set(['b1', 'gone', 'a1']), stories).sort()).toEqual(['a1', 'b1']);
  });
});

describe('taps on the big story', () => {
  it('goes back on the left, forward on the right', () => {
    expect(storyTap('left', 2, 5)).toBe(1);
    expect(storyTap('right', 2, 5)).toBe(3);
  });

  it('folds the band past the last one and stays on the first one', () => {
    expect(storyTap('right', 4, 5)).toBe('close');
    expect(storyTap('left', 0, 5)).toBeNull();
    expect(storyTap('right', 0, 1)).toBe('close');
  });
});

describe('photo in the shutter', () => {
  it('takes the whole width, the shutter as tall as the photo', () => {
    expect(fitStory({ width: 1200, height: 900 }, 400, 700)).toEqual({ width: 400, height: 300 });
    expect(fitStory({ width: 900, height: 1200 }, 400, 700)).toEqual({ width: 400, height: 533 });
  });

  it('is capped by the area, narrower then, and fills it without dimensions', () => {
    expect(fitStory({ width: 900, height: 1600 }, 400, 600)).toEqual({ width: 338, height: 600 });
    expect(fitStory({ width: 0, height: 0 }, 400, 600)).toEqual({ width: 400, height: 600 });
  });
});

describe('railLabel', () => {
  const base = { failed: false, sending: false, published: false, open: false, index: 0, count: 0, fresh: 0, mine: 0 };
  it('says what the band is doing first', () => {
    expect(railLabel({ ...base, failed: true, mine: 1 })).toBe('STORIES · 24 H · ÉCHEC');
    expect(railLabel({ ...base, sending: true, count: 2, fresh: 2 })).toBe('STORIES · 24 H · ENVOI…');
    expect(railLabel({ ...base, published: true, count: 1, mine: 1 })).toBe('STORIES · 24 H · PUBLIÉE');
  });
  it('counts the pages when open', () => {
    expect(railLabel({ ...base, open: true, index: 1, count: 3, mine: 1 })).toBe('STORIES · 24 H · 2 / 3');
    expect(railLabel({ ...base, open: true })).toBe('STORIES · 24 H');
  });
  it('names my story while it is up, with the others', () => {
    expect(railLabel({ ...base, count: 1, mine: 1 })).toBe('STORIES · 24 H · LA TIENNE');
    expect(railLabel({ ...base, count: 3, mine: 1 })).toBe('STORIES · 24 H · LA TIENNE + 2');
    expect(railLabel({ ...base, count: 4, mine: 2 })).toBe('STORIES · 24 H · LES TIENNES + 2');
    expect(railLabel({ ...base, count: 3, mine: 1, fresh: 2 })).toBe('STORIES · 24 H · LA TIENNE · 2 NOUVELLES');
  });
  it('without one of mine: the new ones, or the count', () => {
    expect(railLabel({ ...base, count: 3, fresh: 1 })).toBe('STORIES · 24 H · 1 NOUVELLE');
    expect(railLabel({ ...base, count: 3 })).toBe('STORIES · 24 H · 3');
    expect(railLabel(base)).toBe('STORIES · 24 H');
  });
});
