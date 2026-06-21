/**
 * Per-device triage store for the Notifications Inbox (DESIGN-INBOX §3).
 *
 * Triage — the read / dismissed id-sets plus the "last visited" watermark — is
 * full, client-side, and per-device. It mirrors the defensive persistence
 * pattern in `view-preference.ts`, `fleet-preferences.ts`, and
 * `dashboard-layout.ts`: a namespaced `localStorage` key, Zod-validated on every
 * read, degrading to {@link DEFAULT_TRIAGE} on any failure (missing / corrupt /
 * disabled / over-cap storage) rather than throwing. It never calls GitHub (§9).
 */
import { z } from 'zod';

/** Namespaced key holding the persisted triage state (§3.2). */
const STORAGE_KEY = 'fleet:inbox-triage';

/**
 * Hard cap per id-set (read / dismissed) and the primary backstop against
 * unbounded growth (§3.3). The schema's `.max()` makes a corrupt or hostile
 * payload above this ceiling fail `safeParse` and degrade to
 * {@link DEFAULT_TRIAGE} — mirroring `dashboard-layout.ts`'s `MAX_TILES`.
 * Live-id GC in {@link pruneTriage} is the day-to-day bound; this is the
 * LRU/age backstop.
 */
export const MAX_TRIAGE_IDS = 2000;

/** Cap on a single id's length — GitHub-derived ids are far shorter (§3.2). */
export const MAX_ID_LENGTH = 256;

/**
 * Persistence schema (§3.2). Both id arrays are stored in insertion order
 * (oldest first) so the cap can evict LRU-style from the front. `.max()` is the
 * hard ceiling that rejects an oversized payload before it reaches the app.
 */
export const InboxTriageSchema = z.object({
  readIds: z.array(z.string().min(1).max(MAX_ID_LENGTH)).max(MAX_TRIAGE_IDS),
  dismissedIds: z.array(z.string().min(1).max(MAX_ID_LENGTH)).max(MAX_TRIAGE_IDS),
  lastVisitedAt: z.string().datetime().nullable(),
});

/** Validated triage state persisted per device. */
export type InboxTriage = z.infer<typeof InboxTriageSchema>;

/**
 * The first-visit default: nothing read, nothing dismissed, and a `null`
 * watermark — so on a brand-new device nothing counts as "new since last visit"
 * and the first Inbox load is calm rather than a wall of highlights (§3.1).
 */
export const DEFAULT_TRIAGE: InboxTriage = {
  readIds: [],
  dismissedIds: [],
  lastVisitedAt: null,
};

/** A fresh default so callers never share or mutate {@link DEFAULT_TRIAGE}. */
function defaultTriage(): InboxTriage {
  return { readIds: [], dismissedIds: [], lastVisitedAt: null };
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Persistence is best-effort: ignore quota / disabled-storage failures.
  }
}

/**
 * Reads and validates the stored triage, returning a fresh {@link DEFAULT_TRIAGE}
 * on any problem: nothing stored, corrupt JSON, an invalid shape, an over-cap
 * payload, or disabled storage. Never throws.
 */
export function loadInboxTriage(): InboxTriage {
  const raw = safeGet(STORAGE_KEY);
  if (raw === null) {
    return defaultTriage();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultTriage();
  }

  const result = InboxTriageSchema.safeParse(parsed);
  return result.success ? result.data : defaultTriage();
}

/**
 * Persists the triage as JSON (best-effort). The value is re-validated against
 * {@link InboxTriageSchema} first; an invalid or over-cap value is skipped
 * rather than written, so corrupt state never reaches storage. Never throws.
 */
export function saveInboxTriage(triage: InboxTriage): void {
  const result = InboxTriageSchema.safeParse(triage);
  if (!result.success) {
    return;
  }
  safeSet(STORAGE_KEY, JSON.stringify(result.data));
}

/** Keeps at most {@link MAX_TRIAGE_IDS} ids, evicting the oldest (front) first. */
function capOldestFirst(ids: string[]): string[] {
  return ids.length > MAX_TRIAGE_IDS ? ids.slice(ids.length - MAX_TRIAGE_IDS) : ids;
}

/**
 * Bounds the triage so storage cannot grow unbounded (§3.3). The `useInbox`
 * hook runs it on every load and before every save:
 *
 * 1. **GC absent ids** — drop any read/dismissed id not present in `liveIds`
 *    (the currently derived item set). A resolved run, merged PR, or fixed alert
 *    vanishes from derivation, so its triage mark is forgotten. This ties
 *    retention to live items and is the primary bound.
 * 2. **LRU backstop** — if, after GC, an id-set still exceeds
 *    {@link MAX_TRIAGE_IDS}, evict from the front (oldest insertion first) until
 *    it fits.
 *
 * Insertion order is preserved, the watermark is carried through untouched, and
 * the input is not mutated.
 */
export function pruneTriage(triage: InboxTriage, liveIds: Iterable<string>): InboxTriage {
  const live = new Set(liveIds);
  return {
    readIds: capOldestFirst(triage.readIds.filter((id) => live.has(id))),
    dismissedIds: capOldestFirst(triage.dismissedIds.filter((id) => live.has(id))),
    lastVisitedAt: triage.lastVisitedAt,
  };
}
