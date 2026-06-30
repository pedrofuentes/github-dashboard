/**
 * Per-signal rollout / rollback lever for the REST→GraphQL migration.
 *
 * A single record controls which signals are served via the batched GraphQL
 * fleet-query layer. Flip an entry to `true` to activate that signal's
 * GraphQL deriver; set it back to `false` to roll back to REST without any
 * other code change.
 *
 * Currently enabled: `ci`, `issues`, `pullRequests`, `stale`, and `reviews`.
 */
import type { TileSignalType } from '../types/dashboard';

export const GRAPHQL_SIGNAL_FLAGS: Record<TileSignalType, boolean> = {
  ci: true,
  security: false,
  reviews: true,
  pullRequests: true,
  issues: true,
  stale: true,
  activity: false,
};

/**
 * Typed wrapper over {@link Object.entries} for records whose key type is
 * statically known. `Object.entries` widens keys to `string`, which would
 * otherwise force an unsafe cast at every call site; centralizing it here keeps
 * the cast in one place and hands callers back the precise `[K, V]` tuples.
 */
function typedEntries<K extends string, V>(obj: Record<K, V>): Array<[K, V]> {
  return Object.entries(obj) as Array<[K, V]>;
}

/**
 * Signals currently served via the batched GraphQL fleet-query layer, derived
 * from {@link GRAPHQL_SIGNAL_FLAGS} so flipping a flag updates every consumer.
 */
export const GRAPHQL_ENABLED_SIGNALS: TileSignalType[] = typedEntries(GRAPHQL_SIGNAL_FLAGS)
  .filter(([, enabled]) => enabled)
  .map(([signal]) => signal);

/**
 * Returns `true` when `signal` should be served via the batched GraphQL
 * fleet-query layer instead of its legacy REST hook.
 *
 * @param signal - The {@link TileSignalType} to check.
 */
export function graphqlSignalEnabled(signal: TileSignalType): boolean {
  return GRAPHQL_SIGNAL_FLAGS[signal] ?? false;
}
