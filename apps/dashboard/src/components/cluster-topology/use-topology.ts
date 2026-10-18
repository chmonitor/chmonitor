import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { TopologyData } from './model'

import { useMemo } from 'react'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import { apiFetch } from '@/lib/swr/api-fetch'
import { visibilityAwareInterval } from '@/lib/swr/config'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

interface TopologyResponse {
  success: boolean
  data: TopologyData
}

// Structure (+ per-node live snapshot) is slow-moving — cache hard.
const STRUCTURE_INTERVAL = 60_000
const STRUCTURE_DEDUPE = 55_000

/**
 * Fetch the assembled cluster-topology model from the server route. Layout (x/y)
 * is applied client-side by `layoutTopology`, keeping it out of the wire shape.
 */
export function useTopology(hostId: number) {
  const { settings } = useUserSettings()
  const timezone = settings.timezone

  const params = new URLSearchParams()
  params.append('hostId', String(hostId))
  if (timezone) params.append('timezone', timezone)
  const url = `/api/v1/cluster-topology?${params.toString()}`

  const key = useMemo(
    () => ['/api/v1/cluster-topology', hostId, timezone],
    [hostId, timezone]
  )

  const queryClient = useQueryClient()

  const { data, error, isLoading } = useQuery<TopologyResponse, Error>({
    queryKey: key,
    queryFn: async () => {
      const res = await apiFetch(url)
      await throwIfNotOk(res, 'Failed to fetch cluster topology')
      return res.json() as Promise<TopologyResponse>
    },
    staleTime: STRUCTURE_DEDUPE,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
    refetchInterval: visibilityAwareInterval(STRUCTURE_INTERVAL),
  })

  return {
    topology: data?.data ?? null,
    error,
    isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: key }),
  }
}
