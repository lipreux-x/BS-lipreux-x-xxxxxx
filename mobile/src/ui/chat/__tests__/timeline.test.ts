import { buildTimeline, dayLabel, timeLabel } from '../timeline';

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
