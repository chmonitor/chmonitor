/**
 * Running query summary transformation utilities.
 *
 * These functions transform running query metrics into structured formats
 * suitable for display in overview cards and summaries.
 */

import type {
  SummaryDataTransformed,
  SummaryInputData,
  SummaryMetricsItem,
} from '../types'

/**
 * Transforms running query summary data into a structured format for display.
 *
 * Similar to merge summary but optimized for query monitoring,
 * extracting memory usage, query count, and row throughput metrics.
 *
 * @param data - Combined API response with nested metric arrays
 * @returns Transformed data with primary display info and metric items
 * @returns null if required data (main, totalMem, rowsReadWritten) is missing
 *
 * @example
 * ```ts
 * const input = {
 *   main: [{ query_count: 5, memory_usage: 1024, readable_memory_usage: '1 GiB' }],
 *   totalMem: [{ total: 8192, readable_total: '8 GiB' }],
 *   rowsReadWritten: [{ rows_read: 1000, rows_written: 500, ... }],
 *   todayQueryCount: [{ query_count: 1000 }],
 * }
 *
 * const result = transformRunningQueriesSummaryData(input)
 * // result.primary = { memoryUsage: '1 GiB', queryCount: 5, description: '...' }
 * // result.items = [formatted comparison items]
 * ```
 */
export function transformRunningQueriesSummaryData(
  data: SummaryInputData
): SummaryDataTransformed | null {
  const main = data.main?.[0]
  const totalMem = data.totalMem?.[0]
  const rowsReadWritten = data.rowsReadWritten?.[0]
  const todayQueryCount = data.todayQueryCount?.[0]?.query_count

  if (!main || !totalMem || !rowsReadWritten) {
    return null
  }

  const items: SummaryMetricsItem[] = []

  items.push({
    current: main.memory_usage,
    target: totalMem.total,
    currentReadable: `${main.readable_memory_usage} memory usage`,
    targetReadable: `${totalMem.readable_total} total`,
  })

  items.push({
    current: main.query_count,
    target: todayQueryCount ?? main.query_count,
    currentReadable: `${main.query_count} running queries`,
    targetReadable: `${todayQueryCount ?? main.query_count} today`,
  })

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

  return {
    primary: {
      memoryUsage: main.readable_memory_usage,
      description: 'memory used for running queries',
    },
    items,
    raw: {
      used: {
        query_count: main.query_count,
        memory_usage: main.memory_usage,
        readable_memory_usage: main.readable_memory_usage,
      },
      totalMem,
      rowsReadWritten,
      todayQueryCount,
    },
  }
}
