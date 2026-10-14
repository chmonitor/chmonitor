/**
 * Rolling per-check value history for the /health sparklines.
 *
 * Health checks return only a *current* aggregate (e.g. `count() AS
 * failed_count`) — there is no time-series to draw a trend from. Instead of
 * fabricating one, we accumulate the real values observed on each ~30s refresh
 * into a small capped ring buffer, persisted to localStorage so the trend
 * survives reloads and host switches.
 *
 * Buffers are keyed by `${hostId}::${checkId}` so switching hosts keeps each
 * host's history separate. Mirrors the storage shape of
 * {@link file://./thresholds-storage.ts}.
 */
const STORAGE_KEY = 'health-history'

/** Maximum points kept per check. ~30 × 30s ≈ the last 15 minutes. */
export const MAX_HISTORY_POINTS = 30

export type HistoryMap = Record<string, number[]>

export function historyKey(hostId: number, checkId: string): string {
  return `${hostId}::${checkId}`
}

export function loadHistory(): HistoryMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const sanitized: HistoryMap = {}
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (!Array.isArray(value)) continue
      const points = value
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .slice(-MAX_HISTORY_POINTS)
      if (points.length > 0) sanitized[key] = points
    }
    return sanitized
  } catch {
    return {}
  }
}

/** Append a value to a series, capping at {@link MAX_HISTORY_POINTS}. Pure. */
export function appendPoint(
  series: number[] | undefined,
  value: number
): number[] {
  const next = series ? [...series, value] : [value]
  return next.length > MAX_HISTORY_POINTS
    ? next.slice(next.length - MAX_HISTORY_POINTS)
    : next
}

export function saveHistory(map: HistoryMap): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Quota or serialization failure — sparklines are non-essential, ignore.
  }
}
