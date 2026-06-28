/**
 * localStorage persistence for the Deck's tile-size preference.
 *
 * Mirrors the defensive pattern in `density-preference.ts`: every read is
 * validated and every failure (unavailable / corrupt storage) degrades to the
 * default rather than throwing. The Deck size control persists the choice and
 * every {@link useDeckTileSize} consumer reads it live.
 *
 * The size scales the Stream Deck-style key grid in {@link BoardView}: `medium`
 * reproduces today's layout (~6 keys per row at the default container width),
 * `x-small`/`small` pack more (smaller) keys per row, and `large` shows fewer,
 * bigger keys — useful in full-window mode on a wall display.
 */

/** How large the Deck renders each (repo, signal) key. */
export type DeckTileSize = 'x-small' | 'small' | 'medium' | 'large';

const DECK_TILE_SIZE_KEY = 'fleet:deck-tile-size';

/** Medium reproduces the pre-existing Deck layout, so it stays the default. */
const DEFAULT_DECK_TILE_SIZE: DeckTileSize = 'medium';

/**
 * Per-size key width (px) for the Deck's repo × signal matrix, fed to each repo
 * row's `repeat(<columns>, minmax(0, <px>px))` as the per-column **target/max**.
 * Columns shrink below this to fit narrow viewports (so a repo's signals always
 * stay on one line) and cap at it on wide / full-window displays. `medium`
 * (152px) reproduces the legacy ~6-keys-per-row look at the default width.
 */
export const DECK_TILE_MIN_PX: Record<DeckTileSize, number> = {
  'x-small': 104,
  small: 128,
  medium: 152,
  large: 192,
};

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

/** Type guard: true only for a recognised {@link DeckTileSize} value. */
export function isDeckTileSize(value: string | null): value is DeckTileSize {
  return value === 'x-small' || value === 'small' || value === 'medium' || value === 'large';
}

/** Reads the stored size, defaulting to `'medium'` on any problem. */
export function loadDeckTileSize(): DeckTileSize {
  const raw = safeGet(DECK_TILE_SIZE_KEY);
  return isDeckTileSize(raw) ? raw : DEFAULT_DECK_TILE_SIZE;
}

/** Persists the active size (best-effort). */
export function saveDeckTileSize(size: DeckTileSize): void {
  safeSet(DECK_TILE_SIZE_KEY, size);
}
