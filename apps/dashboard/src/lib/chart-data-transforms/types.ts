/**
 * Shared TypeScript types for chart data transformations.
 *
 * This module defines all the type definitions used across the chart-data-transforms
 * package, providing a single source of truth for data structures.
 */

/**
 * Input data structure for user event count transformations.
 * Represents a row containing event timestamp, user identifier, and count.
 */
export type UserEventCountItem = {
  event_time: string
  user: string
  count: number
}

/**
 * Output structure for user event count transformations.
 * Provides organized data for stacked bar charts with user breakdown.
 */
export type UserEventCountsTransformed<T extends string = string> = {
  /** Nested record: event_time -> user -> count */
  data: Record<T, Record<string, number>>
  /** Alphabetically sorted unique users */
  users: string[]
  /** Flattened data for chart libraries: array of objects with event_time and user keys */
  chartData: Array<Record<T, string> & Record<string, number>>
}

export type MemoryUsageData = {
  memory_usage: number
  readable_memory_usage: string
}

export type TotalMemData = {
  metric: string
  total: number
  readable_total: string
}

export type RowsReadWrittenData = {
  rows_read: number
  rows_written: number
  readable_rows_read: string
  readable_rows_written: string
}

/**
 * Bytes read/written data structure.
 */
export type BytesReadWrittenData = {
  bytes_read: number
  bytes_written: number
  readable_bytes_read: string
  readable_bytes_written: string
}

export type QueryCountData = {
  query_count: number
}

export type SummaryMetricsItem = {
  current: number
  target: number
  currentReadable: string
  targetReadable: string
}

/**
 * Input data structure for summary transformations.
 * Combines multiple related metrics from different queries.
 */
export type SummaryInputData = {
  used?: MemoryUsageData[]
  totalMem?: TotalMemData[]
  rowsReadWritten?: RowsReadWrittenData[]
  bytesReadWritten?: BytesReadWrittenData[]
  todayQueryCount?: QueryCountData[]
  main?: (MemoryUsageData & QueryCountData)[]
}

export type SummaryDataTransformed = {
  /** Primary display values for the card header */
  primary: {
    memoryUsage: string
    description: string
  }
  /** Array of metric items for comparison display */
  items: SummaryMetricsItem[]
  /** Raw data for additional logic if needed */
  raw: {
    used: MemoryUsageData & Partial<QueryCountData>
    totalMem: TotalMemData
    rowsReadWritten: RowsReadWrittenData
    bytesReadWritten?: BytesReadWrittenData
    todayQueryCount?: number
  }
}

export type ReadWritePair = {
  value: number
  readable: string
}
