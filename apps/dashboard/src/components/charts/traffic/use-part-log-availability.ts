import { useChartData } from '@/lib/query/use-chart-data'
import { REFRESH_INTERVAL, useHostId } from '@/lib/swr'

/**
 * Probe whether system.part_log exists on the current host (it is opt-in
 * server config). Drives the /traffic smart-detection for the Bytes on Disk,
 * Merges & Data Movement, and Top Tables sections.
 *
 * Fail-open: only the API's explicit `metadata.unavailable` table_not_found
 * signal reports the table as missing — loading states and transient errors
 * keep the sections visible so a network blip never hides good content.
 */
export function usePartLogAvailability(): {
  available: boolean
  isLoading: boolean
} {
  const hostId = useHostId()

  const detect = useChartData({
    chartName: 'traffic-part-log-detect',
    hostId,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  return {
    available: detect.metadata?.unavailable?.reason !== 'table_not_found',
    isLoading: detect.isLoading,
  }
}
