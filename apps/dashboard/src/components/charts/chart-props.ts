import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'
import type { AreaChartProps } from '@/types/charts'

export interface ChartProps extends Partial<AreaChartProps> {
  title?: string
  interval?: ClickHouseInterval
  className?: string
  chartClassName?: string
  chartCardContentClassName?: string
  lastHours?: number
  hostId?: number
  /** Grid column span (out of 10 columns) for custom layouts */
  colSpan?: number
  /** Navigation target URL when clicked */
  href?: string
  /** Chart query params sent as bound ClickHouse params (e.g. `{ user }`). */
  params?: Record<string, string>
}
