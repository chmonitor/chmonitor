/**
 * Format microseconds into a compact human duration for query-stage bars:
 * `980µs`, `12.3ms`, `1.20s`, `2m 3s`. Pure — unit tested.
 */
export function formatMicros(us: number): string {
  if (!Number.isFinite(us) || us <= 0) return '0µs'
  if (us < 1000) return `${Math.round(us)}µs`
  if (us < 1_000_000) {
    // more precision when sub-10ms (small absolute differences matter there)
    return `${(us / 1000).toFixed(us < 10_000 ? 2 : 1)}ms`
  }
  const s = us / 1_000_000
  if (s < 60) return `${s.toFixed(2)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

/**
 * Width (0..100) of a segment relative to the largest row's total, so the
 * heaviest stage spans the full track and others scale against it. Floors at
 * 0 when there is no max (avoids NaN / divide-by-zero).
 */
export function segmentWidthPct(segment: number, maxTotal: number): number {
  if (maxTotal <= 0) return 0
  const pct = (segment / maxTotal) * 100
  if (!Number.isFinite(pct) || pct < 0) return 0
  return pct > 100 ? 100 : pct
}
