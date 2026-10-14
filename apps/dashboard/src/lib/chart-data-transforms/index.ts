/**
 * Chart data transformation utilities.
 *
 * This module provides a unified export interface for all chart data
 * transformation functions. Functions are organized by domain:
 *
 * - User events: transformUserEventCounts
 * - Merge data: transformMergeSummaryData
 * - Running queries: transformRunningQueriesSummaryData
 * - Common helpers: extractNestedData, formatReadWritePair
 *
 * @example
 * ```ts
 * import { transformUserEventCounts } from '@/lib/chart-data-transforms'
 * // or
 * import { transformMergeSummaryData, extractNestedData } from '@/lib/chart-data-transforms'
 * ```
 */

// Shared types
export type {
  BytesReadWrittenData,
  MemoryUsageData,
  QueryCountData,
  ReadWritePair,
  RowsReadWrittenData,
  SummaryDataTransformed,
  SummaryInputData,
  SummaryMetricsItem,
  TotalMemData,
  UserEventCountItem,
  UserEventCountsTransformed,
} from './types'

// Common helpers
export { extractNestedData, formatReadWritePair } from './transforms/common'
export { transformMergeSummaryData } from './transforms/merge-data'
// Running query transformations
export { transformRunningQueriesSummaryData } from './transforms/running-queries'
// User event transformations
export { transformUserEventCounts } from './transforms/user-events'
