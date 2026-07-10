/**
 * Value formatting for Postgres table cells, driven by `PgColumn.format`
 * (issue #2450). Mirrors the ClickHouse column formatters but on the small,
 * self-contained `PgColumnFormat` set.
 */

import type { PgColumnFormat } from '@/types/pg-query-config'

import { formatReadableSize } from '@/lib/format-readable'
import { formatDuration } from '@/lib/utils'

/** Coerce an unknown row value to a finite number, or `null`. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Format a raw cell value to its display string for a given column format. */
export function formatPgValue(
  value: unknown,
  format: PgColumnFormat = 'text'
): string {
  if (value === null || value === undefined) return '—'

  switch (format) {
    case 'number': {
      const n = toNumber(value)
      return n === null ? String(value) : n.toLocaleString()
    }
    case 'ms': {
      const n = toNumber(value)
      return n === null ? String(value) : `${n.toLocaleString()} ms`
    }
    case 'duration_ms': {
      const n = toNumber(value)
      return n === null ? String(value) : formatDuration(n)
    }
    case 'bytes': {
      const n = toNumber(value)
      return n === null ? String(value) : formatReadableSize(n)
    }
    case 'percent': {
      const n = toNumber(value)
      return n === null ? String(value) : `${n}%`
    }
    default:
      return String(value)
  }
}
