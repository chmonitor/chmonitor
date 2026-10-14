import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'

/**
 * A single date range option for the selector
 */
export interface DateRangeOption {
  /** Display label (e.g., "24h", "7d") */
  label: string
  value: string
  /** Number of hours of historical data (undefined for "all" data) */
  lastHours?: number
  /** Recommended interval granularity for this range */
  interval: ClickHouseInterval
  description?: string
}

/**
 * Configuration for a chart's available date ranges
 */
export interface DateRangeConfig {
  options: DateRangeOption[]
  defaultValue: string
}

/**
 * Current date range selection state
 */
export interface DateRangeValue {
  /** Current value identifier (e.g., "24h") */
  value: string
  /** Number of hours (undefined for "all" data) */
  lastHours?: number
  interval: ClickHouseInterval
}
