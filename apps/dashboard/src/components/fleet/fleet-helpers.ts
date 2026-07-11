/**
 * Pure helpers for the Fleet Overview page — view-mode persistence and metric
 * formatting. Kept free of React/DOM side effects (beyond a guarded
 * `localStorage`) so they are unit-testable in isolation.
 */

/** Fleet Overview layout: `grid` (host cards) or `table` (comparison matrix). */
export type FleetView = 'grid' | 'table'

/** localStorage key persisting the user's Fleet view choice. */
export const FLEET_VIEW_STORAGE_KEY = 'fleet-view'

/** Default view when nothing is persisted. */
export const DEFAULT_FLEET_VIEW: FleetView = 'grid'

/** Coerce an arbitrary stored value into a valid FleetView (fail-safe default). */
export function parseFleetView(value: string | null | undefined): FleetView {
  return value === 'table' || value === 'grid' ? value : DEFAULT_FLEET_VIEW
}

/** Read the persisted Fleet view; SSR-safe (returns the default off-DOM). */
export function readFleetView(): FleetView {
  if (typeof window === 'undefined') return DEFAULT_FLEET_VIEW
  try {
    return parseFleetView(window.localStorage.getItem(FLEET_VIEW_STORAGE_KEY))
  } catch {
    // Private mode / disabled storage — fall back to the default.
    return DEFAULT_FLEET_VIEW
  }
}

/** Persist the Fleet view; no-op off-DOM or when storage is unavailable. */
export function writeFleetView(view: FleetView): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FLEET_VIEW_STORAGE_KEY, view)
  } catch {
    // Ignore write failures (private mode / quota) — non-critical preference.
  }
}

/**
 * Format a metric count for a Fleet table cell. Renders an en-dash for an
 * absent/non-finite value (a host that couldn't report it), else a
 * locale-grouped integer.
 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return Math.trunc(value).toLocaleString()
}
