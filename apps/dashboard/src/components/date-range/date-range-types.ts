import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'

export interface DateRangeOption {
  label: string
  value: string
  lastHours?: number
  interval: ClickHouseInterval
  description?: string
}

export interface DateRangeConfig {
  options: DateRangeOption[]
  defaultValue: string
}

export interface DateRangeValue {
  value: string
  lastHours?: number
  interval: ClickHouseInterval
}
