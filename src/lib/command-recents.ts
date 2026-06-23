/**
 * Recently-run command ids for the ⌘K command palette, persisted with the shared
 * {@link createVersionedStore} so the palette can surface a "Recent" section for
 * an empty query. The list is most-recent-first, de-duplicated, and capped at
 * {@link MAX_COMMAND_RECENTS}; like every versioned store it degrades to an empty
 * list on any storage/parse/schema failure rather than throwing.
 */
import { z } from 'zod';

import { createVersionedStore } from './versioned-storage';
import type { VersionedStore } from './versioned-storage';

/** Namespaced, versioned localStorage key for command-palette recents. */
export const COMMAND_RECENTS_KEY = 'fleet:command-recents:v1';

/** Maximum number of recent command ids retained. */
export const MAX_COMMAND_RECENTS = 6;

const schema = z.array(z.string());

/** Builds the defensive versioned store backing the recents list. */
export function createCommandRecentsStore(): VersionedStore<string[]> {
  return createVersionedStore<string[]>({
    key: COMMAND_RECENTS_KEY,
    schema,
    fallback: () => [],
  });
}

/**
 * Returns a fresh list with `id` moved to the front, de-duplicated and capped at
 * `max`. Pure — never mutates the input.
 */
export function addCommandRecent(
  recents: readonly string[],
  id: string,
  max = MAX_COMMAND_RECENTS,
): string[] {
  return [id, ...recents.filter((existing) => existing !== id)].slice(0, max);
}
