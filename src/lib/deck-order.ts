/**
 * Pure model + defensive persistence for the Deck's row/column ORDER.
 *
 * The Deck (`src/components/board/BoardView.tsx`) renders a repo × signal matrix:
 * one row per repo, signal columns in a consistent order. Two independent,
 * user-customisable orderings drive it:
 *
 * - **repo order** — an array of `nameWithOwner` ids giving the row order;
 * - **signal order** — an array of {@link DECK_SIGNALS} members giving the
 *   global column order.
 *
 * Both are stored sparsely and *reconciled* against the live fleet / signal set
 * on read, so a saved order survives the fleet changing: known ids come first in
 * the saved order, anything new is appended in its natural order, and anything
 * gone is pruned. An empty/absent saved order therefore means "natural order",
 * so brand-new installs and new fleet repos just work.
 *
 * Persistence mirrors the defensive pattern of `deck-visibility.ts`: every read
 * is validated and every failure (missing / corrupt / invalid / unavailable
 * storage) degrades to an empty array rather than throwing.
 */
import { z } from 'zod';

import { DECK_SIGNALS } from './deck-visibility';
import { MAX_STRING_LENGTH } from './dashboard-layout';
import type { TileSignalType } from '../types/dashboard';

/** localStorage keys holding the persisted (sparse) orders. */
const REPO_ORDER_KEY = 'fleet:deck-repo-order';
const SIGNAL_ORDER_KEY = 'fleet:deck-signal-order';

/**
 * Hard cap on a stored repo-order length — generous for any realistic fleet yet
 * bounds a corrupt/oversized payload. Exceeding it makes load default + save
 * skip. The signal order is implicitly bounded by {@link DECK_SIGNALS}.
 */
export const MAX_DECK_REPO_ORDER = 5000;

const RepoOrderSchema = z.array(z.string().min(1).max(MAX_STRING_LENGTH)).max(MAX_DECK_REPO_ORDER);
const SignalOrderSchema = z
  .array(z.string().min(1).max(MAX_STRING_LENGTH))
  .max(DECK_SIGNALS.length * 4);

/**
 * Returns a copy of `order` with the item at `from` moved to `to`. Pure: the
 * input is never mutated. Out-of-range indices (or `from === to`) return a copy
 * in the original order, so a no-op move is a safe identity.
 */
export function moveInOrder<T>(order: readonly T[], from: number, to: number): T[] {
  const next = order.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Generic reconcile: keep `saved` entries that are in `valid` (de-duplicated, in
 * saved order), then append any `valid` entries missing from `saved` in their
 * natural order. An empty `saved` therefore yields `valid` unchanged.
 */
function reconcileOrder<T>(saved: readonly T[], valid: readonly T[]): T[] {
  const validSet = new Set(valid);
  const seen = new Set<T>();
  const kept: T[] = [];
  for (const item of saved) {
    if (validSet.has(item) && !seen.has(item)) {
      seen.add(item);
      kept.push(item);
    }
  }
  for (const item of valid) {
    if (!seen.has(item)) {
      kept.push(item);
    }
  }
  return kept;
}

/**
 * Reconciles a saved repo order against the live `fleet` (`nameWithOwner` ids):
 * saved repos still in the fleet first (de-duplicated, in saved order), then any
 * new fleet repos appended in fleet order. Saved repos absent from the fleet are
 * dropped. Empty `saved` ⇒ `fleet` order.
 */
export function reconcileRepoOrder(saved: readonly string[], fleet: readonly string[]): string[] {
  return reconcileOrder(saved, fleet);
}

/**
 * Reconciles a saved signal order against {@link DECK_SIGNALS}: saved deck
 * signals first (de-duplicated, in saved order), then any missing deck signals
 * appended in `DECK_SIGNALS` order. Non-deck ids (e.g. `activity`) are dropped.
 * Empty `saved` ⇒ `DECK_SIGNALS` order.
 */
export function reconcileSignalOrder(saved: readonly string[]): TileSignalType[] {
  const deckSet = new Set<string>(DECK_SIGNALS);
  const valid = saved.filter((id): id is TileSignalType => deckSet.has(id));
  return reconcileOrder(valid, DECK_SIGNALS);
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

function loadOrder(key: string, schema: z.ZodType<string[]>): string[] {
  const raw = safeGet(key);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : [];
}

function saveOrder(key: string, schema: z.ZodType<string[]>, order: readonly string[]): void {
  const value = Array.from(order);
  if (!schema.safeParse(value).success) return;
  safeSet(key, JSON.stringify(value));
}

/** Reads the persisted (sparse) repo order; `[]` on any problem. Never throws. */
export function loadDeckRepoOrder(): string[] {
  return loadOrder(REPO_ORDER_KEY, RepoOrderSchema);
}

/** Persists the (sparse) repo order (best-effort, validated). Never throws. */
export function saveDeckRepoOrder(order: readonly string[]): void {
  saveOrder(REPO_ORDER_KEY, RepoOrderSchema, order);
}

/** Reads the persisted (sparse) signal order; `[]` on any problem. Never throws. */
export function loadDeckSignalOrder(): TileSignalType[] {
  return loadOrder(SIGNAL_ORDER_KEY, SignalOrderSchema).filter((id): id is TileSignalType =>
    (DECK_SIGNALS as string[]).includes(id),
  );
}

/** Persists the (sparse) signal order (best-effort, validated). Never throws. */
export function saveDeckSignalOrder(order: readonly TileSignalType[]): void {
  saveOrder(SIGNAL_ORDER_KEY, SignalOrderSchema, order);
}
