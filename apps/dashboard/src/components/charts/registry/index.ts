/** Lazy-loaded chart registry with skeleton type hints. */

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
