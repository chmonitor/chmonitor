/**
 * Custom hook for donut chart value formatting
 *
 * Extracted from donut.tsx for better separation of concerns.
 */

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
 * Custom hook for creating a value formatter for donut charts
 *
 * Supports multiple formatting strategies:
 * 1. Custom formatter function
 * 2. Readable format with a dedicated column
 * 3. Readable format applied to the value itself
 * 4. Default number formatting
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

    // No readable format specified - use default number formatting
    if (!readable || !readableColumn) {
      return (value: number) => value.toLocaleString()
    }

    // Create formatter that looks up readable column values
    return (value: number) => {
      // Find the data row that matches this value
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
 * Dispatch a value to the shared readable formatter for its format type.
 *
 * `bytes`/`number`/`quantity` delegate to the shared `lib/format-readable.ts`
 * module (see #2894). `duration` stays on `formatDuration` from `@/lib/utils`
 * because donut/agent-visualization duration values are milliseconds (same
 * convention as the area-chart `readable: 'duration'` usage), while
 * `formatReadableSecondDuration` in `format-readable.ts` expects seconds —
 * swapping it in would silently misformat every duration value.
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
