/**
 * Owns the `FleetView` type and its runtime guard. The last-used persistence
 * (`fleet:view`, `loadViewPreference`/`saveViewPreference`) was removed when the
 * app moved to a single configurable default view (`fleet:default-view`, see
 * `default-view-preference.ts`): the app always opens to the chosen default,
 * never to the last-used view.
 */

/** The ways the authenticated fleet can be presented. */
export type FleetView = 'triage' | 'matrix' | 'grid' | 'dashboard' | 'inbox' | 'deck';

/** Runtime guard, reused by the default-view preference module. */
export function isFleetView(value: string | null): value is FleetView {
  return (
    value === 'triage' ||
    value === 'matrix' ||
    value === 'grid' ||
    value === 'dashboard' ||
    value === 'inbox' ||
    value === 'deck'
  );
}
