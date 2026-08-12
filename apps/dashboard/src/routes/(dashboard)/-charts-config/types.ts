/**
 * Shared types for the overview page chart configuration.
 */

import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'
import type { ComponentType } from 'react'
import type { ChartProps } from '@/components/charts/chart-props'

/**
 * Chart type categories supported by the overview page
 */
export type ChartType = 'area' | 'bar' | 'metric' | 'custom' | 'table'

/**
 * Configuration for a single chart instance in the overview page
 */
export interface OverviewChartConfig<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique identifier for this chart configuration */
  id: string
  /** Chart component to render */
  component: ComponentType<ChartProps & T>
  /** Display title for the chart */
  title?: string
  /** Time interval for data aggregation (e.g., 'toStartOfHour', 'toStartOfDay') */
  interval?: ClickHouseInterval
  /** Number of hours of historical data to display */
  lastHours?: number
  /** Custom CSS className */
  className?: string
  /** Custom chart CSS className */
  chartClassName?: string
  /** Custom chart card content className */
  chartCardContentClassName?: string
  /** Type of chart (for documentation/filtering) */
  type?: ChartType
  /** Additional props to pass to the chart component */
  props?: Omit<T, 'hostId'>
  /** Navigation target URL when clicked */
  href?: string
  /**
   * Render this chart as a full-width banner ABOVE the tab's chart grid (its
   * own auto-height row) instead of as a fixed-height grid cell. Used by the
   * Activity Heatmap hero card so its calendar isn't clipped by the grid's
   * fixed row height.
   */
  fullWidth?: boolean
}

/**
 * Tab configuration for organizing charts into tabs
 */
export interface OverviewTabConfig {
  /** Tab value identifier */
  value: string
  /** Display label for the tab */
  label: string
  /** Grid layout class for the tab content */
  gridClassName: string
  /** Charts to display in this tab */
  charts: OverviewChartConfig[]
  /**
   * Renders bespoke content instead of the chart grid. 'topology' mounts the
   * shared cluster-topology view (with a link through to the full /clusters page).
   */
  customContent?: 'topology'
}
