import { useMemo } from 'react'
import {
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'
import { formatDuration } from '@/lib/utils'

export type ReadableFormat = 'bytes' | 'duration' | 'number' | 'quantity'

export interface UseDonutValueFormatterOptions {
  valueFormatter?: (value: number) => string
  readable?: ReadableFormat
  readableColumn?: string
  data: Record<string, unknown>[]
  valueKey: string
}

/**
 * Builds a value formatter: custom function first, then `readable` applied
 * via a dedicated column or the value itself, else default number formatting.
 */
export function useDonutValueFormatter({
  valueFormatter,
  readable,
  readableColumn,
  data,
  valueKey,
}: UseDonutValueFormatterOptions) {
  return useMemo(() => {
    // Use custom formatter if provided
    if (valueFormatter) return valueFormatter

    if (!readable || !readableColumn) {
      return (value: number) => value.toLocaleString()
    }

    return (value: number) => {
      const row = data.find((d) => Number(d[valueKey]) === value)

      // If we found a row with a readable column, format that value
      if (row && readableColumn in row) {
        const readableValue = row[readableColumn]
        if (typeof readableValue === 'number') {
          return dispatchReadableFormat(readableValue, readable)
        }
        return String(readableValue)
      }

      // Otherwise, format the value itself
      return dispatchReadableFormat(value, readable)
    }
  }, [valueFormatter, readable, readableColumn, data, valueKey])
}

/**
 * `bytes`/`number`/`quantity` use `lib/format-readable.ts`. `duration` stays on
 * `formatDuration` from `@/lib/utils` because donut/agent-visualization
 * durations are milliseconds, while `formatReadableSecondDuration` expects
 * seconds and would silently misformat them.
 */
function dispatchReadableFormat(value: number, format: ReadableFormat): string {
  switch (format) {
    case 'bytes':
      return formatReadableSize(value)
    case 'duration':
      return formatDuration(value)
    case 'number':
    case 'quantity':
      return formatReadableQuantity(value)
    default:
      return value.toLocaleString()
  }
}
