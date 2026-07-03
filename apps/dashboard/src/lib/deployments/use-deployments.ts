/**
 * TanStack Query hook for GitHub deployments (routes/api/v1/deployments.ts) —
 * feeds the deploy-marker overlay on the query-volume timeline
 * (plans/45-github-deploy-correlation.md).
 *
 * Fails open: the read API always 200s with `data: []` when no deployments
 * are configured/stored (no `GITHUB_WEBHOOK_SECRET`, no `CHM_CLOUD_D1`
 * binding), so the overlay simply renders no markers rather than an error.
 */
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { NON_CRITICAL_RETRY } from '@/lib/swr/config'

export interface DeploymentMarker {
  id: string
  ownerScope: string
  repo: string
  environment: string | null
  ref: string | null
  sha: string | null
  version: string | null
  createdAt: number
  receivedAt: number
}

interface DeploymentsApiResponse {
  success: boolean
  data?: DeploymentMarker[]
  error?: string
}

export interface UseDeploymentsOptions {
  sinceMs?: number
  untilMs?: number
  limit?: number
  /** Set to false to skip fetching (e.g. the overlay isn't enabled for this chart). */
  enabled?: boolean
}

export function useDeployments({
  sinceMs,
  untilMs,
  limit,
  enabled = true,
}: UseDeploymentsOptions = {}) {
  const params = new URLSearchParams()
  if (sinceMs !== undefined) params.set('sinceMs', String(sinceMs))
  if (untilMs !== undefined) params.set('untilMs', String(untilMs))
  if (limit !== undefined) params.set('limit', String(limit))
  const query = params.toString()
  const url = `/api/v1/deployments${query ? `?${query}` : ''}`

  const { data, error, isLoading } = useQuery<DeploymentMarker[]>({
    queryKey: ['/api/v1/deployments', sinceMs, untilMs, limit],
    queryFn: async () => {
      const res = await apiFetch(url)
      if (!res.ok) {
        throw new Error(`Failed to fetch deployments: ${res.statusText}`)
      }
      const json: DeploymentsApiResponse = await res.json()
      return json.data ?? []
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: NON_CRITICAL_RETRY,
  })

  return {
    deployments: data ?? [],
    error,
    isLoading,
  }
}
