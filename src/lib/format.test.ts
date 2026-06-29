import { formatCount, formatDelta, formatRelativeTime } from './format';

describe('formatCount', () => {
  it('returns small numbers unchanged', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(42)).toBe('42');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands with a "k" suffix', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(15000)).toBe('15k');
  });

  it('abbreviates millions with an "M" suffix', () => {
    expect(formatCount(1_000_000)).toBe('1M');
    expect(formatCount(2_500_000)).toBe('2.5M');
  });

  it('preserves the sign of negative numbers', () => {
    expect(formatCount(-1500)).toBe('-1.5k');
  });

  it('returns "0" for non-finite values', () => {
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('formatDelta', () => {
  it('prefixes positive values with an upward triangle', () => {
    expect(formatDelta(3)).toBe('▲3');
  });

  it('prefixes negative values with a downward triangle', () => {
    expect(formatDelta(-2)).toBe('▼2');
  });

  it('renders zero as an em dash', () => {
    expect(formatDelta(0)).toBe('—');
  });

  it('abbreviates magnitude via formatCount', () => {
    expect(formatDelta(1500)).toBe('▲1.5k');
    expect(formatDelta(-2_500_000)).toBe('▼2.5M');
  });

  it('renders non-finite values as an em dash', () => {
    expect(formatDelta(Number.NaN)).toBe('—');
    expect(formatDelta(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatDelta(Number.NEGATIVE_INFINITY)).toBe('—');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2024-01-15T12:00:00.000Z');
  const ago = (ms: number): Date => new Date(now.getTime() - ms);

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;

  it('reports very recent times as "just now"', () => {
    expect(formatRelativeTime(ago(30 * SECOND), now)).toBe('just now');
  });

  it('formats minutes, singular and plural', () => {
    expect(formatRelativeTime(ago(MINUTE), now)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(5 * MINUTE), now)).toBe('5 minutes ago');
  });

  it('formats hours, singular and plural', () => {
    expect(formatRelativeTime(ago(HOUR), now)).toBe('1 hour ago');
    expect(formatRelativeTime(ago(3 * HOUR), now)).toBe('3 hours ago');
  });

  it('formats days, singular and plural', () => {
    expect(formatRelativeTime(ago(DAY), now)).toBe('1 day ago');
    expect(formatRelativeTime(ago(2 * DAY), now)).toBe('2 days ago');
  });

  it('formats weeks, singular and plural', () => {
    expect(formatRelativeTime(ago(WEEK + DAY), now)).toBe('1 week ago');
    expect(formatRelativeTime(ago(2 * WEEK + DAY), now)).toBe('2 weeks ago');
  });

  it('accepts ISO string and epoch-millisecond inputs', () => {
    expect(formatRelativeTime(ago(2 * HOUR).toISOString(), now)).toBe('2 hours ago');
    expect(formatRelativeTime(ago(2 * HOUR).getTime(), now)).toBe('2 hours ago');
  });

  it('treats future timestamps as "just now"', () => {
    expect(formatRelativeTime(new Date(now.getTime() + HOUR), now)).toBe('just now');
  });

  it('returns "unknown" for invalid dates', () => {
    expect(formatRelativeTime('not-a-real-date', now)).toBe('unknown');
  });
});
