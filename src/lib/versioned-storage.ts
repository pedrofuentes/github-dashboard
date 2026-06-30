/**
 * Generic, defensive, versioned localStorage store factory. Future persisted
 * features (filter v2, saved views, dashboard-view v2) build on this instead of
 * re-implementing the same defensive boilerplate found in
 * `src/lib/repo-filter-preference.ts` and `src/lib/dashboard-layout.ts`.
 *
 * Like those modules, every read is Zod-validated and every failure (storage
 * unavailable / full / corrupt, parse error, schema mismatch) degrades to a
 * caller-supplied fallback rather than throwing. A store may additionally
 * `migrate` a legacy payload — run on the parsed `unknown` BEFORE validation —
 * so older persisted shapes are upgraded in place on read.
 */
import type { z } from 'zod';

/** Configuration for a single versioned store, parameterised by its value type. */
export interface VersionedStoreConfig<T> {
  /** Namespaced, versioned key, e.g. `fleet:saved-views:v1`. */
  key: string;
  /** Schema the persisted value must satisfy to be returned from `load`. */
  schema: z.ZodType<T>;
  /** Produces a fresh default value; called on every miss/failure. */
  fallback: () => T;
  /**
   * Optional upgrade hook applied to the parsed `unknown` before validation,
   * letting legacy shapes (e.g. a pre-envelope bare array) become valid.
   */
  migrate?: (raw: unknown) => unknown;
}

/** The handle returned by {@link createVersionedStore}. */
export interface VersionedStore<T> {
  /** Reads, (optionally) migrates and validates the value; never throws. */
  load(): T;
  /** Validates then persists the value; returns false on validation/storage failure. */
  save(value: T): boolean;
  /** Removes the persisted key (best-effort); never throws. */
  clear(): void;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Persistence is best-effort: ignore quota / disabled-storage failures.
    return false;
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort: ignore disabled-storage failures.
  }
}

/**
 * Builds a defensive, versioned localStorage store for values of type `T`.
 * All three returned methods swallow storage exceptions and degrade to the
 * configured fallback (on read) or a no-op (on write/clear) rather than throwing.
 */
export function createVersionedStore<T>(config: VersionedStoreConfig<T>): VersionedStore<T> {
  const { key, schema, fallback, migrate } = config;

  return {
    load(): T {
      const raw = safeGet(key);
      if (raw === null) return fallback();

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fallback();
      }

      try {
        const candidate = migrate ? migrate(parsed) : parsed;
        const result = schema.safeParse(candidate);
        return result.success ? result.data : fallback();
      } catch (err) {
        // A throwing `migrate` (corrupt/legacy payload) must never escape `load`.
        console.warn('versioned-storage: migrate/parse failure, returning fallback', key, err);
        return fallback();
      }
    },

    save(value: T): boolean {
      if (!schema.safeParse(value).success) return false;
      return safeSet(key, JSON.stringify(value));
    },

    clear(): void {
      safeRemove(key);
    },
  };
}
