/**
 * Per-repo display aliases + localStorage persistence (Phase 3 customization).
 *
 * A user may give a repo a short alias shown on its tile instead of the full
 * `owner/name`. This module owns the defensive persistence: every read is
 * validated and every failure (unavailable / full / corrupt storage) degrades
 * to a sane default (`{}`) rather than throwing, mirroring the pattern in
 * `src/lib/dashboard-layout.ts`.
 */
import { z } from 'zod';

import { MAX_STRING_LENGTH } from './dashboard-layout';

/** Maximum length of a single alias; longer values are clamped on set. */
export const ALIAS_MAX_LENGTH = 48;
/** Hard cap on how many aliases a stored map may contain. */
export const MAX_ALIASES = 100;

/** Namespaced key holding the persisted alias map. */
const STORAGE_KEY = 'fleet:aliases';

const AliasMapSchema = z
  .record(z.string().min(1).max(MAX_STRING_LENGTH), z.string().min(1).max(ALIAS_MAX_LENGTH))
  .refine((obj) => Object.keys(obj).length <= MAX_ALIASES, {
    message: `at most ${MAX_ALIASES} aliases`,
  });

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
 * Reads and validates the persisted alias map. Any missing/corrupt/invalid
 * result falls back to `{}`. Never throws.
 */
export function loadAliases(): Record<string, string> {
  const raw = safeGet(STORAGE_KEY);
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const result = AliasMapSchema.safeParse(parsed);
  return result.success ? result.data : {};
}

/**
 * Persists the alias map as JSON (best-effort). The map is re-validated first;
 * an invalid map is skipped rather than written. Never throws.
 */
export function saveAliases(map: Record<string, string>): void {
  if (!AliasMapSchema.safeParse(map).success) return;
  safeSet(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Sets (or clears) the alias for one repo and persists the result. The alias is
 * trimmed and clamped to {@link ALIAS_MAX_LENGTH}; an empty/whitespace-only
 * alias clears that repo's entry. Returns the next map.
 */
export function setAlias(repo: string, alias: string): Record<string, string> {
  const trimmed = alias.trim().slice(0, ALIAS_MAX_LENGTH);
  const current = loadAliases();
  // Rebuild without `repo` (avoids a dynamic `delete`), re-adding it when set.
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (key !== repo) next[key] = value;
  }
  if (trimmed !== '') next[repo] = trimmed;
  saveAliases(next);
  return next;
}

/** Clears the alias for one repo and persists the result. Returns the next map. */
export function clearAlias(repo: string): Record<string, string> {
  return setAlias(repo, '');
}
