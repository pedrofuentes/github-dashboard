/**
 * Owns the `FleetView` type and its runtime guard. The last-used persistence
 * (`fleet:view`, `loadViewPreference`/`saveViewPreference`) was removed when the
 * app moved to a single configurable default view (`fleet:default-view`, see
 * `default-view-preference.ts`): the app always opens to the chosen default,
 * never to the last-used view.
 */

/** The ways the authenticated fleet can be presented. */
export const FLEET_VIEWS = ['triage', 'matrix', 'grid', 'dashboard', 'inbox', 'deck'] as const;

/** The ways the authenticated fleet can be presented. */
export type FleetView = (typeof FLEET_VIEWS)[number];

/** Runtime guard, reused by the default-view preference module. */
export function isFleetView(value: string | null): value is FleetView {
  return value !== null && (FLEET_VIEWS as readonly string[]).includes(value);
}
