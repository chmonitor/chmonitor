// Barrel for the data-fetching helpers. NOTE: the directory name `swr` is
// legacy — the app uses TanStack Query (see ../query). These are generic fetch
// helpers + the router-based host hook, not SWR-specific.

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
