import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { HostInfo } from '@chm/types/host-info'

import { apiFetch } from './api-fetch'
import {
  HOSTS_QUERY_KEY,
  readCachedHosts,
  writeCachedHosts,
} from './host-cache'
import { ErrorLogger } from '@chm/logger'
import { useCallback, useEffect } from 'react'

interface HostsResponse {
  success: boolean
  data?: HostInfo[]
}

class HostsFetchError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'HostsFetchError'
  }
}

export function useHosts() {
  const fetcher = useCallback(async (): Promise<HostInfo[]> => {
    const response = await apiFetch('/api/v1/hosts')
    if (!response.ok) {
      ErrorLogger.logWarning(
        `Failed to fetch hosts: ${response.status} ${response.statusText}`,
        { component: 'useHosts' }
      )
      throw new HostsFetchError(
        `Failed to fetch hosts: ${response.status}`,
        response.status
      )
    }
    const result = (await response.json()) as HostsResponse
    return result.success && result.data ? result.data : []
  }, [])

  const queryClient = useQueryClient()

  const { data, error, isLoading } = useQuery<HostInfo[]>({
    queryKey: HOSTS_QUERY_KEY,
    queryFn: fetcher,
    staleTime: 300000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    // Don't hammer the server when auth is the problem — a 401/403 won't change
    // on retry. Other failures keep the default-ish 2 retries.
    retry: (failureCount, err) => {
      const status = err instanceof HostsFetchError ? err.status : undefined
      if (status === 401 || status === 403) return false
      return failureCount < 2
    },
  })

  // Hydration-safe instant host list.
  //
  // We seed the cache AFTER mount (not via `initialData`, which renders at SSR
  // time and would mismatch the prerendered skeleton — there is no localStorage
  // on the server). On the first client paint the query has no data, matching
  // the server HTML; this effect then fills it from the dedicated host cache so
  // the selector shows the previous list immediately, even on the first load
  // after a deploy when the git-SHA-busted query cache is empty. The background
  // fetch still runs and overwrites it (stale-while-revalidate). When the
  // persisted query cache already restored hosts, `getQueryData` is truthy and
  // this is a no-op.
  useEffect(() => {
    if (queryClient.getQueryData<HostInfo[]>(HOSTS_QUERY_KEY)) return
    const cached = readCachedHosts()
    if (cached && cached.length > 0) {
      queryClient.setQueryData(HOSTS_QUERY_KEY, cached)
    }
  }, [queryClient])

  // Mirror every non-empty host list back into the dedicated cache so the next
  // cold load can seed it. Writing a restored/seeded value back is harmless and
  // keeps the entry fresh.
  useEffect(() => {
    if (data && data.length > 0 && !error) {
      writeCachedHosts(data)
    }
  }, [data, error])

  const status = error instanceof HostsFetchError ? error.status : undefined

  return {
    hosts: data ?? [],
    error,
    isLoading,
    isUnauthorized: status === 401 || status === 403,
  }
}
