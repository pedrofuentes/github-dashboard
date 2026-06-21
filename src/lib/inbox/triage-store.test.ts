import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TRIAGE,
  InboxTriageSchema,
  loadInboxTriage,
  MAX_ID_LENGTH,
  MAX_TRIAGE_IDS,
  pruneTriage,
  saveInboxTriage,
  type InboxTriage,
} from './triage-store';

/** Namespaced key per §3.2 — asserted by value, never via a setItem spy (#124). */
const STORAGE_KEY = 'fleet:inbox-triage';

/** A representative, valid watermark (`toISOString()`-shaped, UTC `Z`). */
const WATERMARK = '2026-06-21T08:33:30.948Z';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('DEFAULT_TRIAGE (§3.1)', () => {
  it('is empty read/dismissed sets with a null watermark (nothing "new" on first visit)', () => {
    expect(DEFAULT_TRIAGE).toEqual({ readIds: [], dismissedIds: [], lastVisitedAt: null });
  });

  it('is itself a valid InboxTriage', () => {
    expect(InboxTriageSchema.safeParse(DEFAULT_TRIAGE).success).toBe(true);
  });
});

describe('loadInboxTriage / saveInboxTriage — round-trip & defensive defaults (AC-9)', () => {
  it('returns DEFAULT_TRIAGE when nothing is stored (device never opened the Inbox)', () => {
    expect(loadInboxTriage()).toEqual(DEFAULT_TRIAGE);
  });

  it('round-trips a valid InboxTriage through save → load', () => {
    const triage: InboxTriage = {
      readIds: ['ci:octo/a:1', 'review:octo/a:#2'],
      dismissedIds: ['stale:octo/a:issue:#3'],
      lastVisitedAt: WATERMARK,
    };

    saveInboxTriage(triage);

    // Persistence is asserted via the stored VALUE, not a setItem spy-count (#124).
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(loadInboxTriage()).toEqual(triage);
  });

  it('round-trips the default (empty sets, null watermark)', () => {
    saveInboxTriage(DEFAULT_TRIAGE);
    expect(loadInboxTriage()).toEqual(DEFAULT_TRIAGE);
  });

  it('persists under the namespaced `fleet:inbox-triage` key as JSON', () => {
    const triage: InboxTriage = {
      readIds: ['ci:octo/a:1'],
      dismissedIds: [],
      lastVisitedAt: null,
    };
    saveInboxTriage(triage);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual(triage);
  });

  it('degrades to DEFAULT_TRIAGE on corrupt JSON, never throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(() => loadInboxTriage()).not.toThrow();
    expect(loadInboxTriage()).toEqual(DEFAULT_TRIAGE);
  });

  it('degrades to DEFAULT_TRIAGE on a structurally invalid payload', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ readIds: 'nope', dismissedIds: [], lastVisitedAt: null }),
    );
    expect(loadInboxTriage()).toEqual(DEFAULT_TRIAGE);
  });

  it('degrades to DEFAULT_TRIAGE when an id-set exceeds MAX_TRIAGE_IDS (oversized payload)', () => {
    const oversized = {
      readIds: Array.from({ length: MAX_TRIAGE_IDS + 1 }, (_, i) => `ci:octo/a:${i}`),
      dismissedIds: [],
      lastVisitedAt: null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oversized));
    expect(loadInboxTriage()).toEqual(DEFAULT_TRIAGE);
  });

  it('degrades to DEFAULT_TRIAGE when lastVisitedAt is not a valid datetime', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ readIds: [], dismissedIds: [], lastVisitedAt: 'yesterday' }),
    );
    expect(loadInboxTriage()).toEqual(DEFAULT_TRIAGE);
  });

  it('degrades to DEFAULT_TRIAGE when localStorage.getItem throws (disabled storage)', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadInboxTriage()).toEqual(DEFAULT_TRIAGE);
  });

  it('does not return the shared DEFAULT_TRIAGE reference (no shared mutable state)', () => {
    const loaded = loadInboxTriage();
    expect(loaded).toEqual(DEFAULT_TRIAGE);
    expect(loaded).not.toBe(DEFAULT_TRIAGE);
    loaded.readIds.push('ci:octo/a:1');
    expect(DEFAULT_TRIAGE.readIds).toEqual([]);
  });

  it('does not persist a triage that fails schema validation (empty-string id)', () => {
    const invalid = { readIds: [''], dismissedIds: [], lastVisitedAt: null } as InboxTriage;
    saveInboxTriage(invalid);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not persist an oversized triage (schema cap enforced before write)', () => {
    const oversized = {
      readIds: Array.from({ length: MAX_TRIAGE_IDS + 1 }, (_, i) => `ci:octo/a:${i}`),
      dismissedIds: [],
      lastVisitedAt: null,
    } as InboxTriage;
    saveInboxTriage(oversized);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('swallows localStorage.setItem throwing (best-effort persistence)', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveInboxTriage(DEFAULT_TRIAGE)).not.toThrow();
  });
});

describe('pruneTriage — GC, LRU cap & immutability (AC-10)', () => {
  it('GCs ids absent from liveIds (resolved/aged-out items forget their marks)', () => {
    const triage: InboxTriage = {
      readIds: ['ci:octo/a:1', 'ci:octo/a:2', 'ci:octo/a:3'],
      dismissedIds: ['review:octo/a:#9', 'review:octo/a:#10'],
      lastVisitedAt: WATERMARK,
    };
    const liveIds = new Set(['ci:octo/a:1', 'ci:octo/a:3', 'review:octo/a:#10', 'ci:octo/a:99']);

    const pruned = pruneTriage(triage, liveIds);

    expect(pruned.readIds).toEqual(['ci:octo/a:1', 'ci:octo/a:3']);
    expect(pruned.dismissedIds).toEqual(['review:octo/a:#10']);
    // GC never touches the watermark.
    expect(pruned.lastVisitedAt).toBe(WATERMARK);
  });

  it('accepts liveIds as any iterable, not only a Set (e.g. an array of derived ids)', () => {
    const triage: InboxTriage = {
      readIds: ['a', 'b', 'c'],
      dismissedIds: [],
      lastVisitedAt: null,
    };
    const pruned = pruneTriage(triage, ['c', 'a']);
    expect(pruned.readIds).toEqual(['a', 'c']);
  });

  it('preserves insertion order (oldest first) while GCing', () => {
    const triage: InboxTriage = {
      readIds: ['x1', 'x2', 'x3', 'x4'],
      dismissedIds: [],
      lastVisitedAt: null,
    };
    const pruned = pruneTriage(triage, new Set(['x4', 'x1', 'x3']));
    expect(pruned.readIds).toEqual(['x1', 'x3', 'x4']);
  });

  it('drops both id-sets entirely when nothing is live', () => {
    const triage: InboxTriage = {
      readIds: ['a', 'b'],
      dismissedIds: ['c'],
      lastVisitedAt: WATERMARK,
    };
    const pruned = pruneTriage(triage, new Set());
    expect(pruned.readIds).toEqual([]);
    expect(pruned.dismissedIds).toEqual([]);
    expect(pruned.lastVisitedAt).toBe(WATERMARK);
  });

  it('enforces MAX_TRIAGE_IDS by evicting from the front (oldest insertion first)', () => {
    const ids = Array.from({ length: MAX_TRIAGE_IDS + 5 }, (_, i) => `ci:octo/a:${i}`);
    const triage: InboxTriage = { readIds: ids, dismissedIds: [], lastVisitedAt: null };

    // All ids are live, so only the LRU cap applies (not GC).
    const pruned = pruneTriage(triage, new Set(ids));

    expect(pruned.readIds).toHaveLength(MAX_TRIAGE_IDS);
    // The 5 oldest (front) are dropped; the newest MAX_TRIAGE_IDS survive in order.
    expect(pruned.readIds[0]).toBe('ci:octo/a:5');
    expect(pruned.readIds.at(-1)).toBe(`ci:octo/a:${MAX_TRIAGE_IDS + 4}`);
  });

  it('GCs before applying the cap (GC can bring an over-cap set back under the ceiling)', () => {
    const ids = Array.from({ length: MAX_TRIAGE_IDS + 10 }, (_, i) => `ci:octo/a:${i}`);
    const triage: InboxTriage = { readIds: ids, dismissedIds: [], lastVisitedAt: null };

    // Only the first 100 remain live → GC drops the rest, well under the cap.
    const pruned = pruneTriage(triage, new Set(ids.slice(0, 100)));

    expect(pruned.readIds).toHaveLength(100);
    expect(pruned.readIds[0]).toBe('ci:octo/a:0');
    expect(pruned.readIds.at(-1)).toBe('ci:octo/a:99');
  });

  it('caps each id-set independently', () => {
    const readIds = Array.from({ length: MAX_TRIAGE_IDS + 2 }, (_, i) => `r${i}`);
    const dismissedIds = Array.from({ length: MAX_TRIAGE_IDS + 3 }, (_, i) => `d${i}`);
    const triage: InboxTriage = { readIds, dismissedIds, lastVisitedAt: null };

    const pruned = pruneTriage(triage, new Set([...readIds, ...dismissedIds]));

    expect(pruned.readIds).toHaveLength(MAX_TRIAGE_IDS);
    expect(pruned.dismissedIds).toHaveLength(MAX_TRIAGE_IDS);
  });

  it('a pruned result always satisfies the schema cap (cannot grow unbounded)', () => {
    const ids = Array.from({ length: MAX_TRIAGE_IDS + 50 }, (_, i) => `ci:octo/a:${i}`);
    const triage: InboxTriage = { readIds: ids, dismissedIds: [], lastVisitedAt: null };
    const pruned = pruneTriage(triage, new Set(ids));
    expect(InboxTriageSchema.safeParse(pruned).success).toBe(true);
  });

  it('does not mutate the input triage', () => {
    const triage: InboxTriage = {
      readIds: ['a', 'b'],
      dismissedIds: ['c'],
      lastVisitedAt: null,
    };
    pruneTriage(triage, new Set(['a']));
    expect(triage.readIds).toEqual(['a', 'b']);
    expect(triage.dismissedIds).toEqual(['c']);
  });
});

describe('InboxTriageSchema — hard ceiling rejects oversized/hostile payloads (AC-10 §3.3)', () => {
  it('rejects an id-set larger than MAX_TRIAGE_IDS', () => {
    const oversized = {
      readIds: Array.from({ length: MAX_TRIAGE_IDS + 1 }, (_, i) => `ci:octo/a:${i}`),
      dismissedIds: [],
      lastVisitedAt: null,
    };
    expect(InboxTriageSchema.safeParse(oversized).success).toBe(false);
  });

  it('accepts an id-set exactly at the cap', () => {
    const atCap = {
      readIds: Array.from({ length: MAX_TRIAGE_IDS }, (_, i) => `ci:octo/a:${i}`),
      dismissedIds: [],
      lastVisitedAt: null,
    };
    expect(InboxTriageSchema.safeParse(atCap).success).toBe(true);
  });

  it('rejects an empty-string id and an over-length id', () => {
    expect(
      InboxTriageSchema.safeParse({ readIds: [''], dismissedIds: [], lastVisitedAt: null }).success,
    ).toBe(false);
    const tooLong = 'a'.repeat(MAX_ID_LENGTH + 1);
    expect(
      InboxTriageSchema.safeParse({ readIds: [tooLong], dismissedIds: [], lastVisitedAt: null })
        .success,
    ).toBe(false);
  });

  it('accepts a null or a valid ISO-8601 watermark but rejects a non-datetime string', () => {
    expect(
      InboxTriageSchema.safeParse({ readIds: [], dismissedIds: [], lastVisitedAt: null }).success,
    ).toBe(true);
    expect(
      InboxTriageSchema.safeParse({ readIds: [], dismissedIds: [], lastVisitedAt: WATERMARK })
        .success,
    ).toBe(true);
    expect(
      InboxTriageSchema.safeParse({ readIds: [], dismissedIds: [], lastVisitedAt: 'not-a-date' })
        .success,
    ).toBe(false);
  });
});
