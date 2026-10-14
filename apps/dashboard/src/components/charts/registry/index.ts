/**
 * Chart Registry - Main Exports
 *
 * Centralized chart registry system for lazy-loading chart components.
 * Provides type-safe access to all registered charts with proper skeleton hints.
 *
 * @example
 * ```tsx
 * import { getChartComponent, hasChart } from '@/components/charts/registry'
 *
 * if (hasChart('query-count')) {
 *   const Chart = getChartComponent('query-count')
 *   return <Chart hostId={0} />
 * }
 * ```
 */

export type { ChartCategory } from './chart-categories'
export type {
  ChartComponent,
  ChartProps,
  ChartRegistryMap,
  ChartSkeletonType,
  LazyChartComponent,
} from './types'

export { CHART_CATEGORIES, CHARTS_BY_CATEGORY } from './chart-categories'
export { chartImports } from './chart-imports'
export {
  getChartComponent,
  getChartsByCategory,
  getRegisteredChartNames,
  hasChart,
} from './registry-fns'
export { CHART_TYPE_HINTS, getChartSkeletonType } from './type-hints'
