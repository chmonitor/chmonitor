/**
 * Re-export layer over the `registry/` folder so pages can lazy-load chart
 * components by name.
 */

export {
  CHART_CATEGORIES,
  CHART_TYPE_HINTS,
  CHARTS_BY_CATEGORY,
  type ChartCategory,
  type ChartComponent,
  type ChartProps,
  type ChartRegistryMap,
  type ChartSkeletonType,
  chartImports,
  getChartComponent,
  getChartSkeletonType,
  getChartsByCategory,
  getRegisteredChartNames,
  hasChart,
  type LazyChartComponent,
} from './registry'
