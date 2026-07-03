/**
 * Per-rule / per-host alert routing (plan 30). Unlike
 * `use-webhook-subscriptions.ts`, this is NOT Clerk-gated — the API
 * (`/api/v1/health/routes`) resolves an OSS single-tenant owner id when no
 * Clerk session exists, so self-hosted deployments can manage routes with
 * zero auth (see `lib/health/alert-routing-auth.ts`). Query/mutation split
 * mirrors the webhook-subscriptions hook.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface AlertRouteInfo {
  id: string
  matchRule: string
  matchHost: string
  channelUrl: string
  enabled: boolean
  createdAt: number
}

export const ALERT_ROUTES_QUERY_KEY = ['/api/v1/health/routes'] as const

export function useAlertRoutes(enabled = true) {
  const query = useQuery({
    queryKey: ALERT_ROUTES_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/routes')
      await throwIfNotOk(response, 'Failed to load alert routes')
      const json = (await response.json()) as {
        success: boolean
        routes: AlertRouteInfo[]
      }
      return json.routes ?? []
    },
    enabled,
    staleTime: 30_000,
  })

  return {
    routes: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useAlertRoutesMutations() {
  const queryClient = useQueryClient()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ALERT_ROUTES_QUERY_KEY })

  const createRoute = async (input: {
    matchRule: string
    matchHost: string
    channelUrl: string
  }): Promise<AlertRouteInfo> => {
    const response = await apiFetch('/api/v1/health/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to create alert route')
    invalidate()
    const json = (await response.json()) as {
      success: boolean
      route: AlertRouteInfo
    }
    return json.route
  }

  const deleteRoute = async (id: string): Promise<void> => {
    const response = await apiFetch(
      `/api/v1/health/routes?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    await throwIfNotOk(response, 'Failed to delete alert route')
    invalidate()
  }

  return { createRoute, deleteRoute, invalidate }
}
