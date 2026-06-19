const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function round(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * Formats a count into a compact, human-readable label
 * (e.g. `1500` → `1.5k`, `2_500_000` → `2.5M`). Non-finite values render as `0`.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  const abs = Math.abs(value);
  if (abs < 1_000) {
    return String(value);
  }

  const sign = value < 0 ? '-' : '';
  if (abs < 1_000_000) {
    return `${sign}${round(abs / 1_000)}k`;
  }

  return `${sign}${round(abs / 1_000_000)}M`;
}

function pluralize(value: number, unit: string): string {
  return `${String(value)} ${unit}${value === 1 ? '' : 's'} ago`;
}

/**
 * Formats a past timestamp as a coarse relative label (e.g. `3 hours ago`).
 *
 * Accepts a `Date`, an ISO string, or epoch milliseconds. Future timestamps are
 * clamped to `just now`, and unparseable inputs render as `unknown`.
 *
 * @param now - injectable "current time", defaulting to `new Date()` (keeps the function pure for tests).
 */
export function formatRelativeTime(input: Date | string | number, now: Date = new Date()): string {
  const then = input instanceof Date ? input : new Date(input);
  const thenMs = then.getTime();
  if (Number.isNaN(thenMs)) {
    return 'unknown';
  }

  const elapsed = Math.max(0, now.getTime() - thenMs);
  if (elapsed < MINUTE) {
    return 'just now';
  }
  if (elapsed < HOUR) {
    return pluralize(Math.floor(elapsed / MINUTE), 'minute');
  }
  if (elapsed < DAY) {
    return pluralize(Math.floor(elapsed / HOUR), 'hour');
  }
  if (elapsed < WEEK) {
    return pluralize(Math.floor(elapsed / DAY), 'day');
  }
  return pluralize(Math.floor(elapsed / WEEK), 'week');
}
