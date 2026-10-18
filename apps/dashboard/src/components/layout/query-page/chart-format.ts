import { formatReadableSize } from '@/lib/format-readable'
import { formatDuration } from '@/lib/utils'

export type ChartValueUnit = 'count' | 'bytes' | 'ms' | 'seconds' | 'percent'

export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (Number.isInteger(n)) return n.toLocaleString()
  return n.toFixed(2)
}

export function formatChartValue(value: number, unit?: ChartValueUnit): string {
  switch (unit) {
    case 'bytes':
      return formatReadableSize(value)
    case 'ms':
      return formatDuration(value)
    case 'seconds':
      return formatDuration(value * 1000)
    case 'percent':
      return `${Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value)}%`
    default:
      return formatCompact(value)
  }
}

const FIELD_UNIT_PATTERNS: Array<[RegExp, ChartValueUnit]> = [
  [/(duration_ms|_ms|_millis)$/i, 'ms'],
  [/(_s|_sec|_secs|_seconds)$/i, 'seconds'],
  [/(bytes|memory|_size|^size|_space)/i, 'bytes'],
  [/(pct|percent)/i, 'percent'],
]

export function inferUnit(field: string | null | undefined): ChartValueUnit {
  if (!field) return 'count'
  for (const [pattern, unit] of FIELD_UNIT_PATTERNS) {
    if (pattern.test(field)) return unit
  }
  return 'count'
}
