/**
 * Persistence for the presentational repo-scope filter (Phase 3). The dashboard
 * can be narrowed to a chosen subset of repos; an empty selection means "all
 * repos shown" — the default.
 *
 * Storage access mirrors `src/lib/dashboard-layout.ts`: every read is validated
 * and reconciled against the current fleet, and every failure (unavailable /
 * full / corrupt storage) degrades to a sane default rather than throwing.
 */
import { z } from 'zod';

import type { Repo } from '../types/fleet';
import { MAX_STRING_LENGTH } from './dashboard-layout';

/** Namespaced key holding the persisted repo-filter selection. */
const STORAGE_KEY = 'fleet:repo-filter';

/** A selection is a bounded array of `owner/repo` strings. */
const RepoFilterSchema = z.array(z.string().min(1).max(MAX_STRING_LENGTH));

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
 * Reads, validates, and reconciles the persisted selection against the current
 * fleet. Repos no longer present are dropped and duplicates removed; any
 * missing/corrupt/invalid payload — or one emptied by reconciliation — yields
 * `[]`, i.e. "all repos shown". Never throws.
 */
export function loadRepoFilter(repos: Repo[]): string[] {
  const raw = safeGet(STORAGE_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const result = RepoFilterSchema.safeParse(parsed);
  if (!result.success) return [];
  const present = new Set(repos.map((r) => r.nameWithOwner));
  const reconciled = [...new Set(result.data)].filter((name) => present.has(name));
  return reconciled; // empty ⇒ "all", the default
}

/**
 * Persists the selection as JSON (best-effort). The caller-supplied array is
 * re-validated and deduped first; an invalid payload is skipped rather than
 * written, so an oversized/corrupt selection never reaches storage. Never throws.
 */
export function saveRepoFilter(selected: string[]): void {
  if (!RepoFilterSchema.safeParse(selected).success) return;
  safeSet(STORAGE_KEY, JSON.stringify([...new Set(selected)]));
}
