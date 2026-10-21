import { agoLabel, buildTimeline, countdownLabel, dateTimeLabel, dayLabel, dayRange, timeLabel } from '../timeline';

const now = new Date(2026, 9, 19, 15, 0); // Mon 19 Oct 2026, 15:00 local
const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m);

describe('labels', () => {
  it('formats times and days', () => {
    expect(timeLabel(at(19, 9, 5))).toBe('09:05');
    expect(dayLabel(at(19, 0, 1), now)).toBe('AUJOURD’HUI');
    expect(dayLabel(at(18, 23, 59), now)).toBe('HIER');
    expect(dayLabel(at(14, 12, 0), now)).toBe('MER. 14 OCT.');
    expect(dayLabel(new Date(2025, 11, 31), now)).toBe('MER. 31 DÉC. 2025');
  });
});

describe('self-destruct dates', () => {
  it('formats the date and the time left', () => {
    expect(dateTimeLabel(at(22, 14, 5), now)).toBe('jeu. 22 oct. à 14:05');
    expect(dateTimeLabel(new Date(2027, 0, 2, 9, 0), now)).toBe('sam. 2 janv. 2027 à 09:00');
    expect(countdownLabel(new Date(now.getTime() + 30_000), now)).toBe('dans 1 min');
    expect(countdownLabel(at(19, 15, 12), now)).toBe('dans 12 min');
    expect(countdownLabel(at(20, 20, 0), now)).toBe('dans 29 h');
    expect(countdownLabel(at(26, 15, 0), now)).toBe('dans 7 j');
  });
});

describe('stories', () => {
  it('says how long ago a story was posted', () => {
    expect(agoLabel(new Date(now.getTime() - 20_000), now)).toBe('à l’instant');
    expect(agoLabel(at(19, 14, 48), now)).toBe('il y a 12 min');
    expect(agoLabel(at(19, 9, 30), now)).toBe('il y a 5 h');
    expect(agoLabel(at(17, 15, 0), now)).toBe('il y a 2 j');
  });
});

describe('dayRange', () => {
  it('spans whole local days ending with the chosen one', () => {
    expect(dayRange(at(14, 12, 30), 1)).toEqual({ from: at(14, 0, 0), to: at(15, 0, 0) });
    expect(dayRange(at(14, 12, 30), 2)).toEqual({ from: at(13, 0, 0), to: at(15, 0, 0) });
    expect(dayRange(at(14, 12, 30), 7)).toEqual({ from: at(8, 0, 0), to: at(15, 0, 0) });
    // Across a month boundary.
    expect(dayRange(new Date(2026, 10, 2, 8), 7)).toEqual({ from: at(27, 0, 0), to: new Date(2026, 10, 3) });
  });
});

describe('buildTimeline', () => {
  const msg = (key: string, senderId: string, date: Date) => ({ key, senderId, at: date });

  it('adds a separator per day and groups runs from the same sender', () => {
    const items = buildTimeline(
      [
        msg('a', 'alice', at(18, 20, 0)),
        msg('b', 'alice', at(19, 10, 0)), // new day: new run
        msg('c', 'alice', at(19, 10, 2)), // same run
        msg('d', 'bob', at(19, 10, 3)), // other sender
        msg('e', 'bob', at(19, 10, 20)), // 17 min later: new run
      ],
      now,
    );
    expect(items.map((i) => (i.kind === 'day' ? i.label : `${i.key}:${+i.first}${+i.last}`))).toEqual([
      'HIER',
      'a:11',
      'AUJOURD’HUI',
      'b:10',
      'c:01',
      'd:11',
      'e:11',
    ]);
  });

  it('handles an empty chat', () => {
    expect(buildTimeline([], now)).toEqual([]);
  });
});
