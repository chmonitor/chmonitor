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

/**
 * Format a ratio (0..1) as a whole percentage for a Fleet cell. En-dash when
 * the value is absent/non-finite, so a host that couldn't report it degrades
 * like every other metric.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

/**
 * Ratio of `used` to `total`, or undefined when either side is missing or the
 * total is not positive (avoids a divide-by-zero rendering as `Infinity%`).
 */
export function safeRatio(
  used: number | null | undefined,
  total: number | null | undefined
): number | undefined {
  if (!Number.isFinite(used as number) || !Number.isFinite(total as number)) {
    return undefined
  }
  if ((total as number) <= 0) return undefined
  return (used as number) / (total as number)
}

/** One host's contribution to the fleet summary. */
export interface FleetSummaryEntry {
  /** `unknown` covers browser-stored connections, which have no status probe. */
  state: 'online' | 'offline' | 'unknown' | 'loading'
  version?: string
  runningQueries?: number
  databases?: number
  tables?: number
}

/** Aggregate fleet-wide figures rendered by the summary strip. */
export interface FleetSummary {
  total: number
  online: number
  offline: number
  /** Distinct ClickHouse versions among hosts that reported one, sorted. */
  versions: string[]
  /** True when hosts disagree on version — surfaced as a subtle warning. */
  versionDrift: boolean
  /** Sums stay undefined when NO host reported the metric (vs. a genuine 0). */
  runningQueries?: number
  databases?: number
  tables?: number
}

/**
 * Reduce per-host status into the fleet summary. Pure: the caller collects the
 * entries from each host's own `useHostStatus` (hooks at the deepest consumer).
 */
export function computeFleetSummary(
  entries: readonly FleetSummaryEntry[]
): FleetSummary {
  const versions = new Set<string>()
  let online = 0
  let offline = 0
  let runningQueries: number | undefined
  let databases: number | undefined
  let tables: number | undefined

  const add = (acc: number | undefined, v: number | undefined) =>
    Number.isFinite(v as number) ? (acc ?? 0) + (v as number) : acc

  for (const entry of entries) {
    if (entry.state === 'online') online += 1
    else if (entry.state === 'offline') offline += 1
    if (entry.version) versions.add(entry.version)
    runningQueries = add(runningQueries, entry.runningQueries)
    databases = add(databases, entry.databases)
    tables = add(tables, entry.tables)
  }

  const sorted = [...versions].sort()
  return {
    total: entries.length,
    online,
    offline,
    versions: sorted,
    versionDrift: sorted.length > 1,
    runningQueries,
    databases,
    tables,
  }
}

/**
 * Build an SVG polyline `points` string for a sparkline over `values`, scaled
 * into a `width` x `height` box (y inverted so higher values sit higher).
 * Returns an empty string for fewer than two finite points; a flat series is
 * drawn as a centred horizontal line rather than collapsing onto the baseline.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number
): string {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length < 2) return ''
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const span = max - min
  const step = width / (finite.length - 1)
  return finite
    .map((v, i) => {
      const ratio = span === 0 ? 0.5 : (v - min) / span
      const y = height - ratio * height
      return `${(i * step).toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
