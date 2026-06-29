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
 * Generous watermark horizon (§3.3). A `lastVisitedAt` older than this — more
 * than ~half a year stale — is reset by {@link pruneTriage} so the "new since
 * last visit" highlight stays meaningful instead of marking a wall of events
 * "new" after a long absence (#233).
 */
export const WATERMARK_HORIZON_MS = 180 * 24 * 60 * 60 * 1000;

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
 * Resets a `lastVisitedAt` older than {@link WATERMARK_HORIZON_MS} to `null`
 * (§3.3, #233), but only when a `now` instant is supplied; without it the
 * watermark is carried through untouched so the prune stays a pure id-set GC. A
 * `null` or unparseable watermark is left as-is.
 */
function resetStaleWatermark(lastVisitedAt: string | null, now: number | undefined): string | null {
  if (lastVisitedAt === null || now === undefined) {
    return lastVisitedAt;
  }
  const visited = Date.parse(lastVisitedAt);
  if (Number.isNaN(visited)) {
    return lastVisitedAt;
  }
  return now - visited > WATERMARK_HORIZON_MS ? null : lastVisitedAt;
}

/** Tuning knobs for {@link pruneTriage}; all optional and backward-compatible. */
export interface PruneTriageOptions {
  /**
   * Retains a read/dismissed id whose item is absent from `liveIds` when this
   * returns `true`. Used to protect a mark whose signal slice merely had a
   * transient fetch failure this refresh, so a momentary error does not silently
   * forget triage that will reappear once the fetch recovers (#249).
   */
  protect?: (id: string) => boolean;
  /**
   * Current epoch-ms instant. When supplied, a `lastVisitedAt` older than
   * {@link WATERMARK_HORIZON_MS} resets to `null` so the watermark stays
   * meaningful (§3.3, #233). Omitted (the default) carries the watermark through
   * untouched, keeping the prune a pure id-set GC.
   */
  now?: number;
}

/**
 * Bounds the triage so storage cannot grow unbounded (§3.3). The `useInbox`
 * hook runs it on every load and before every save:
 *
 * 1. **GC absent ids** — drop any read/dismissed id not present in `liveIds`
 *    (the currently derived item set) unless `options.protect` retains it. A
 *    resolved run, merged PR, or fixed alert vanishes from derivation, so its
 *    triage mark is forgotten; a slice that merely failed to fetch this refresh
 *    is protected so its marks survive the blip (#249). This ties retention to
 *    live items and is the primary bound.
 * 2. **LRU backstop** — if, after GC, an id-set still exceeds
 *    {@link MAX_TRIAGE_IDS}, evict from the front (oldest insertion first) until
 *    it fits. Protection cannot defeat this hard ceiling.
 * 3. **Watermark horizon** — a `lastVisitedAt` older than
 *    {@link WATERMARK_HORIZON_MS} resets to `null` when `options.now` is
 *    supplied (§3.3, #233); otherwise it is carried through untouched.
 *
 * Insertion order is preserved and the input is not mutated.
 */
export function pruneTriage(
  triage: InboxTriage,
  liveIds: Iterable<string>,
  options: PruneTriageOptions = {},
): InboxTriage {
  const { protect, now } = options;
  const live = new Set(liveIds);
  const keep = (id: string): boolean => live.has(id) || (protect?.(id) ?? false);
  return {
    readIds: capOldestFirst(triage.readIds.filter(keep)),
    dismissedIds: capOldestFirst(triage.dismissedIds.filter(keep)),
    lastVisitedAt: resetStaleWatermark(triage.lastVisitedAt, now),
  };
}
