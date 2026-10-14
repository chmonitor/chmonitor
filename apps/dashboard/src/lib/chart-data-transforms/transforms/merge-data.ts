/**
 * Merge operation summary transformation utilities.
 *
 * These functions transform merge operation metrics into structured formats
 * suitable for display in overview cards and summaries.
 */

import type {
  SummaryDataTransformed,
  SummaryInputData,
  SummaryMetricsItem,
} from '../types'

/**
 * Transforms merge summary data into a structured format for display.
 *
 * Extracts memory usage, rows read/written, and bytes read/written metrics,
 * creating formatted comparison items showing current vs total values.
 *
 * @param data - Combined API response with nested metric arrays
 * @returns Transformed data with primary display info and metric items
 * @returns null if required data (used, totalMem, rowsReadWritten) is missing
 *
 * @example
 * ```ts
 * const input = {
 *   used: [{ memory_usage: 1024, readable_memory_usage: '1 GiB' }],
 *   totalMem: [{ total: 8192, readable_total: '8 GiB' }],
 *   rowsReadWritten: [{ rows_read: 1000, rows_written: 500, ... }],
 *   bytesReadWritten: [{ bytes_read: 10000, bytes_written: 5000, ... }],
 * }
 *
 * const result = transformMergeSummaryData(input)
 * // result.primary = { memoryUsage: '1 GiB', description: 'memory used for merges' }
 * // result.items = [formatted comparison items]
 * ```
 */
export function transformMergeSummaryData(
  data: SummaryInputData
): SummaryDataTransformed | null {
  const used = data.used?.[0]
  const totalMem = data.totalMem?.[0]
  const rowsReadWritten = data.rowsReadWritten?.[0]
  const bytesReadWritten = data.bytesReadWritten?.[0]

  if (!used || !totalMem || !rowsReadWritten) {
    return null
  }

  const items: SummaryMetricsItem[] = []

  if (rowsReadWritten.rows_read < rowsReadWritten.rows_written) {
    items.push({
      current: rowsReadWritten.rows_read,
      target: rowsReadWritten.rows_written,
      currentReadable: `${rowsReadWritten.readable_rows_read} rows read`,
      targetReadable: `${rowsReadWritten.readable_rows_written} rows written`,
    })
  } else {
    items.push({
      current: rowsReadWritten.rows_written,
      target: rowsReadWritten.rows_read,
      currentReadable: `${rowsReadWritten.readable_rows_written} rows written`,
      targetReadable: `${rowsReadWritten.readable_rows_read} rows read`,
    })
  }

  if (bytesReadWritten) {
    if (bytesReadWritten.bytes_read < bytesReadWritten.bytes_written) {
      items.push({
        current: bytesReadWritten.bytes_read,
        target: bytesReadWritten.bytes_written,
        currentReadable: `${bytesReadWritten.readable_bytes_read} read (uncompressed)`,
        targetReadable: `${bytesReadWritten.readable_bytes_written} written (uncompressed)`,
      })
    } else {
      items.push({
        current: bytesReadWritten.bytes_written,
        target: bytesReadWritten.bytes_read,
        currentReadable: `${bytesReadWritten.readable_bytes_written} written (uncompressed)`,
        targetReadable: `${bytesReadWritten.readable_bytes_read} read (uncompressed)`,
      })
    }
  }

  items.push({
    current: used.memory_usage,
    target: totalMem.total,
    currentReadable: `${used.readable_memory_usage} memory used`,
    targetReadable: `${totalMem.readable_total} total`,
  })

  return {
    primary: {
      memoryUsage: used.readable_memory_usage,
      description: 'memory used for merges',
    },
    items,
    raw: {
      used,
      totalMem,
      rowsReadWritten,
      bytesReadWritten,
    },
  }
}
