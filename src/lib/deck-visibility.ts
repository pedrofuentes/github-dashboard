/**
 * Pure model + defensive persistence for the Deck's per-key tile visibility.
 *
 * The Deck (`src/components/board/BoardView.tsx`) renders one key per
 * (repo × signal). Which keys a user has removed is modelled as a `Set<string>`
 * of `repo:signal` ids — the HIDDEN set. An empty set therefore means "all
 * visible", so nothing has to be enumerated up-front and brand-new fleet repos
 * appear automatically. This state is intentionally independent of the
 * Boards/dashboard tile visibility (`src/lib/tile-visibility.ts`).
 *
 * Every transform is pure in the style of `tile-visibility.ts`: the input set is
 * never mutated and the SAME set instance is returned when nothing changes, so
 * consumers can rely on referential identity to skip work. Persistence mirrors
 * the defensive pattern of `density-preference.ts` / `alias-preference.ts`:
 * every read is validated and every failure (missing / corrupt / unavailable
 * storage) degrades to an empty set rather than throwing.
 */
import { z } from 'zod';

import { MAX_STRING_LENGTH } from './dashboard-layout';
import type { TileSignalType } from '../types/dashboard';

/**
 * The six signals the Deck renders per repo, in fixed left-to-right order.
 * `activity` is deliberately absent (no signal slice — out of scope for the
 * Deck). Single source of truth: `BoardView` imports this list.
 */
export const DECK_SIGNALS: TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
];

/** Namespaced localStorage key holding the persisted hidden-keys array. */
const STORAGE_KEY = 'fleet:deck-hidden';

/**
 * Hard cap on how many hidden ids a stored set may contain — generous enough to
 * never bite a realistic fleet (≈ repos × {@link DECK_SIGNALS}.length) yet bounds
 * a corrupt/oversized payload. Exceeding it makes load default and save skip.
 */
export const MAX_HIDDEN_DECK_KEYS = 5000;

const HiddenKeysSchema = z
  .array(z.string().min(1).max(MAX_STRING_LENGTH))
  .max(MAX_HIDDEN_DECK_KEYS);

/** The stable id for one Deck key: `${repo}:${signal}` (repo = `nameWithOwner`). */
export function deckKeyId(repo: string, signal: TileSignalType): string {
  return `${repo}:${signal}`;
}

/** True when the (repo, signal) key is in the hidden set. */
export function isHidden(hidden: Set<string>, repo: string, signal: TileSignalType): boolean {
  return hidden.has(deckKeyId(repo, signal));
}

/**
 * Adds or removes a list of ids, returning the SAME set when every id is already
 * in the desired state and a new set otherwise. The clone is created lazily on
 * the first real change, so an all-no-op call is referentially stable.
 */
function withIdsHidden(hidden: Set<string>, ids: readonly string[], hide: boolean): Set<string> {
  let next: Set<string> | null = null;
  for (const id of ids) {
    if (hidden.has(id) === hide) continue;
    next ??= new Set(hidden);
    if (hide) next.add(id);
    else next.delete(id);
  }
  return next ?? hidden;
}

/**
 * Hides (`hide`) or shows (`!hide`) one (repo, signal) key. Pure: the input is
 * never mutated and the SAME set is returned when the key is already in the
 * desired state.
 */
export function setKeyHidden(
  hidden: Set<string>,
  repo: string,
  signal: TileSignalType,
  hide: boolean,
): Set<string> {
  return withIdsHidden(hidden, [deckKeyId(repo, signal)], hide);
}

/**
 * Flips one (repo, signal) key's visibility. Always returns a new set (the state
 * always changes). Pure: the input is never mutated.
 */
export function toggleKey(hidden: Set<string>, repo: string, signal: TileSignalType): Set<string> {
  return setKeyHidden(hidden, repo, signal, !isHidden(hidden, repo, signal));
}

/**
 * Hides or shows one `signal` across the given `repos` (the per-signal column
 * toggle). Pure (see {@link setKeyHidden}); SAME set when nothing changes.
 */
export function setSignalHidden(
  hidden: Set<string>,
  repos: readonly string[],
  signal: TileSignalType,
  hide: boolean,
): Set<string> {
  return withIdsHidden(
    hidden,
    repos.map((repo) => deckKeyId(repo, signal)),
    hide,
  );
}

/**
 * Hides or shows the given `signals` for one `repo` (the per-repo row toggle).
 * Pure (see {@link setKeyHidden}); SAME set when nothing changes.
 */
export function setRepoHidden(
  hidden: Set<string>,
  repo: string,
  signals: readonly TileSignalType[],
  hide: boolean,
): Set<string> {
  return withIdsHidden(
    hidden,
    signals.map((signal) => deckKeyId(repo, signal)),
    hide,
  );
}

/**
 * Bulk "Hide all" / "Show all". `hide=true` ⇒ exactly every (repo, signal) id of
 * the given grid (ids outside the grid are dropped); `hide=false` ⇒ the empty
 * set. Pure: the input is never mutated and the SAME set is returned when it
 * already equals the target (a full grid for `hide`, empty otherwise).
 */
export function setAllHidden(
  hidden: Set<string>,
  repos: readonly string[],
  signals: readonly TileSignalType[],
  hide: boolean,
): Set<string> {
  if (!hide) {
    return hidden.size === 0 ? hidden : new Set();
  }
  const full = new Set<string>();
  for (const repo of repos) {
    for (const signal of signals) full.add(deckKeyId(repo, signal));
  }
  if (full.size === hidden.size) {
    let identical = true;
    for (const id of full) {
      if (!hidden.has(id)) {
        identical = false;
        break;
      }
    }
    if (identical) return hidden;
  }
  return full;
}

/**
 * Builds the hidden set that keeps visible ONLY the signals in `keep`: every
 * (repo, signal) whose signal is NOT in `keep` is hidden. An empty `keep` hides
 * the whole grid; a full `keep` returns an empty set. Always a fresh set.
 */
export function showOnlySignals(
  repos: readonly string[],
  signals: readonly TileSignalType[],
  keep: Set<TileSignalType>,
): Set<string> {
  const hidden = new Set<string>();
  for (const repo of repos) {
    for (const signal of signals) {
      if (!keep.has(signal)) hidden.add(deckKeyId(repo, signal));
    }
  }
  return hidden;
}

/** Per-signal visibility tally driving the panel's tri-state column toggles. */
export interface DeckSignalSummary {
  /** The signal this row counts. */
  signal: TileSignalType;
  /** How many of the `repos` show this signal. */
  shown: number;
  /** Total repos considered (`repos.length`). */
  total: number;
}

/** Per-repo visibility tally driving the panel's tri-state row toggles. */
export interface DeckRepoSummary {
  /** The repo (`nameWithOwner`) this row counts. */
  repo: string;
  /** How many of the `signals` this repo shows. */
  shown: number;
  /** Total signals considered (`signals.length`). */
  total: number;
}

/**
 * Tallies `{ shown, total }` for each signal across the given repos, in
 * `signals` order, so the panel can render an all/some/none control per signal.
 */
export function signalVisibilitySummary(
  hidden: Set<string>,
  repos: readonly string[],
  signals: readonly TileSignalType[],
): DeckSignalSummary[] {
  return signals.map((signal) => {
    let shown = 0;
    for (const repo of repos) {
      if (!isHidden(hidden, repo, signal)) shown += 1;
    }
    return { signal, shown, total: repos.length };
  });
}

/**
 * Tallies `{ shown, total }` for each repo across the given signals, in `repos`
 * order, so the panel can render an all/some/none control per repo.
 */
export function repoVisibilitySummary(
  hidden: Set<string>,
  repos: readonly string[],
  signals: readonly TileSignalType[],
): DeckRepoSummary[] {
  return repos.map((repo) => {
    let shown = 0;
    for (const signal of signals) {
      if (!isHidden(hidden, repo, signal)) shown += 1;
    }
    return { repo, shown, total: signals.length };
  });
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
 * Reads and validates the persisted hidden-keys set. Any missing / corrupt /
 * invalid / unavailable result degrades to an empty set. Never throws.
 */
export function loadHiddenDeckKeys(): Set<string> {
  const raw = safeGet(STORAGE_KEY);
  if (raw === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  const result = HiddenKeysSchema.safeParse(parsed);
  return result.success ? new Set(result.data) : new Set();
}

/**
 * Persists the hidden-keys set as a JSON string array (best-effort). The set is
 * re-validated first; an invalid (e.g. over-cap) set is skipped rather than
 * written, leaving any previous value intact. Never throws.
 */
export function saveHiddenDeckKeys(hidden: Set<string>): void {
  const ids = Array.from(hidden);
  if (!HiddenKeysSchema.safeParse(ids).success) return;
  safeSet(STORAGE_KEY, JSON.stringify(ids));
}
