/**
 * Chart Registry - Dynamic chart component loader
 *
 * Provides a centralized registry for lazy-loading chart components
 * to eliminate duplicate imports across 30+ page files.
 *
 * This is a convenience re-export layer. The actual implementation
 * is organized in the `registry/` folder for better maintainability.
 *
 * Charts are organized by category:
 * - query/      - Query-related charts
 * - merge/      - Merge operation charts
 * - system/     - System metrics
 * - replication/ - Replication charts
 * - zookeeper/  - ZooKeeper charts
 * - factory/    - Factory functions for creating charts
 * - primitives/  - Base chart components
 *
 * @example
 * ```tsx
 * import { getChartComponent, hasChart } from '@/components/charts/chart-registry'
 *
 * if (hasChart('query-count')) {
 *   const Chart = getChartComponent('query-count')
 *   return <Chart hostId={0} />
 * }
 * ```
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
