/**
 * Refresh-interval presets (ported from the Next app). The SWR-typed
 * `swrConfig`/`onErrorRetry` presets are intentionally dropped — retry/backoff
 * now lives in the TanStack Query client defaults (src/lib/query/provider.tsx).
 * The interval constants + visibility-aware helper are kept because the data
 * hooks reference them.
 */

export const REFRESH_INTERVAL = {
  /** Never refresh (static data) */
  NEVER: 0,
  /** Refresh every 15 seconds - critical real-time data only */
  FAST_15S: 15_000,
  /** Refresh every 30 seconds - important real-time metrics */
  MEDIUM_30S: 30_000,
  /** Refresh every 60 seconds - default for most metrics */
  DEFAULT_60S: 60_000,
  /** Refresh every 2 minutes - slower changing data */
  SLOW_2M: 120_000,
  /** Refresh every 5 minutes - historical/trend data */
  VERY_SLOW_5M: 300_000,
} as const

export type RefreshInterval =
  (typeof REFRESH_INTERVAL)[keyof typeof REFRESH_INTERVAL]

/**
 * Retry count for NON-CRITICAL, always-on polling hooks (host status,
 * notifications, cluster counts, AI quota). These run continuously in the
 * background regardless of the current page, so the global `retry: 3` default
 * (see src/lib/query/provider.tsx) turns a single transient blip or a missing
 * optional table into 4 Worker→ClickHouse round-trips per poll — pure cost with
 * no user-facing benefit, since the next scheduled refetch recovers anyway.
 * One retry absorbs a one-off network hiccup without amplifying load.
 *
 * Primary data hooks keep their own retry policy (e.g. use-chart-data.ts stops
 * on 4xx); do NOT apply this to them.
 */
export const NON_CRITICAL_RETRY = 1

/**
 * Visibility-aware refresh interval. Returns `false` (paused) when the tab is
 * hidden, otherwise the given interval — shape matches TanStack Query's
 * `refetchInterval: number | false | (() => number | false)`.
 */
export function visibilityAwareInterval(ms: number): () => number | false {
  return () => (typeof document !== 'undefined' && document.hidden ? false : ms)
}
