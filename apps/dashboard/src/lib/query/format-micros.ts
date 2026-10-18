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

export function segmentWidthPct(segment: number, maxTotal: number): number {
  if (maxTotal <= 0) return 0
  const pct = (segment / maxTotal) * 100
  if (!Number.isFinite(pct) || pct < 0) return 0
  return pct > 100 ? 100 : pct
}
