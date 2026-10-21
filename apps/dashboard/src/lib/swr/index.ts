// Barrel for the data-fetching helpers. The `swr` directory name is legacy; these are TanStack Query hooks.

// Re-export TanStack Query hooks + types from ../query so that components
// importing from '@/lib/swr' (the legacy path) find them.
export {
  type ChartDataPoint,
  type ChartMetadata,
  type StaleError,
  type UseChartResult,
  useChartData,
} from '../query/use-chart-data'
export { useTableData } from '../query/use-table-data'
export { apiFetch } from './api-fetch'
export {
  CHART_FRESHNESS,
  chartCachePolicy,
  chartRefreshInterval,
} from './chart-freshness'
export {
  REFRESH_INTERVAL,
  type RefreshInterval,
  visibilityAwareInterval,
} from './config'
export { type FetchError, throwIfNotOk } from './fetch-error'
export { useActions } from './use-actions'
export { useHostId } from './use-host'
export { usePeerDB } from './use-peerdb-data'
