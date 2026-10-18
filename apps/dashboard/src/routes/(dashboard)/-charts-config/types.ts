import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'
import type { ComponentType } from 'react'
import type { ChartProps } from '@/components/charts/chart-props'

export type ChartType = 'area' | 'bar' | 'metric' | 'custom' | 'table'

export interface OverviewChartConfig<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string
  component: ComponentType<ChartProps & T>
  title?: string
  /** Time interval for data aggregation (e.g., 'toStartOfHour', 'toStartOfDay') */
  interval?: ClickHouseInterval
  lastHours?: number
  className?: string
  chartClassName?: string
  chartCardContentClassName?: string
  type?: ChartType
  props?: Omit<T, 'hostId'>
  href?: string
  /** Own auto-height row above the grid, so a tall card is not clipped by the fixed row height. */
  fullWidth?: boolean
}

export interface OverviewTabConfig {
  value: string
  label: string
  gridClassName: string
  charts: OverviewChartConfig[]
  /** Replaces the chart grid with bespoke content. */
  customContent?: 'topology'
}
