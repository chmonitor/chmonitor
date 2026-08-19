import { useQuery } from '@tanstack/react-query'

import type { ReleasesPayload } from '@/lib/whats-new/types'

import { apiFetch } from '@/lib/swr/api-fetch'

export const RELEASES_QUERY_KEY = ['whats-new-releases'] as const

async function fetchReleases(): Promise<ReleasesPayload> {
  const response = await apiFetch('/api/v1/releases')
  const payload = (await response.json()) as ReleasesPayload
  if (!payload || !Array.isArray(payload.data)) {
    return {
      success: false,
      source: 'none',
      data: [],
      error: 'Release notes are temporarily unavailable.',
    }
  }
  return payload
}

export function useReleases() {
  const query = useQuery({
    queryKey: RELEASES_QUERY_KEY,
    queryFn: fetchReleases,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: typeof window !== 'undefined',
  })

  return {
    releases: query.data?.data ?? [],
    source: query.data?.source ?? 'none',
    error: query.data?.error ?? (query.error ? query.error.message : undefined),
    isLoading: query.isPending,
    refetch: query.refetch,
  }
}
