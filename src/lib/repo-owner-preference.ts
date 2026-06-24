/**
 * localStorage persistence for whether repo labels show the owner segment.
 * Mirrors the defensive pattern in `density-preference.ts` / `view-preference.ts`:
 * every read is validated and every failure (unavailable / corrupt storage)
 * degrades to the default rather than throwing. The toggle persists the
 * preference and every {@link useRepoOwner} consumer reads it live.
 */
import type { Repo } from '../types/fleet';

/** Whether a repo label renders with (`show`) or without (`hide`) its owner. */
export type RepoOwnerDisplay = 'show' | 'hide';

const REPO_OWNER_KEY = 'fleet:repo-owner';

/** `show` stays the default so the existing `owner/repo` labels are preserved. */
const DEFAULT_REPO_OWNER_DISPLAY: RepoOwnerDisplay = 'show';

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

function isRepoOwnerDisplay(value: string | null): value is RepoOwnerDisplay {
  return value === 'show' || value === 'hide';
}

/** Reads the stored display, defaulting to `'show'` on any problem. */
export function loadRepoOwnerPreference(): RepoOwnerDisplay {
  const raw = safeGet(REPO_OWNER_KEY);
  return isRepoOwnerDisplay(raw) ? raw : DEFAULT_REPO_OWNER_DISPLAY;
}

/** Persists the active display (best-effort). */
export function saveRepoOwnerPreference(display: RepoOwnerDisplay): void {
  safeSet(REPO_OWNER_KEY, display);
}

/**
 * The single source of truth for a repo's visible label: the full
 * `owner/repo` when the owner is shown, or the bare repo name when hidden.
 */
export function formatRepoLabel(repo: Repo, display: RepoOwnerDisplay): string {
  return display === 'hide' ? repo.name : repo.nameWithOwner;
}
