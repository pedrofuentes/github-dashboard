/**
 * localStorage persistence for the user's configurable DEFAULT view — the view
 * the app opens to on every load. Per the cofounder decision the app ALWAYS
 * opens to this chosen default; "resume last-used" is dropped. Mirrors the
 * defensive pattern in `view-preference.ts` / `density-preference.ts`: every
 * read is validated and every failure (unavailable / corrupt storage) degrades
 * to the factory default rather than throwing.
 */
import { isFleetView } from './view-preference';
import type { FleetView } from './view-preference';

const DEFAULT_VIEW_KEY = 'fleet:default-view';

/** Triage (ADR-030) is the default home that answers "what needs me now?". */
const FALLBACK_DEFAULT_VIEW: FleetView = 'triage';

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

/** Reads the stored default view, defaulting to `'triage'` on any problem. */
export function loadDefaultView(): FleetView {
  const raw = safeGet(DEFAULT_VIEW_KEY);
  return isFleetView(raw) ? raw : FALLBACK_DEFAULT_VIEW;
}

/** Persists the chosen default view (best-effort). */
export function saveDefaultView(view: FleetView): boolean {
  return safeSet(DEFAULT_VIEW_KEY, view);
}
