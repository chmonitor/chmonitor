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

/**
 * Destination provider: `'webhook'` (plan 30), `'pagerduty'` (plan 34),
 * `'telegram'` (#2655), or `'ntfy'` (#2657).
 */
export type AlertRouteProvider = 'webhook' | 'pagerduty' | 'telegram' | 'ntfy'

export interface AlertRouteInfo {
  id: string
  matchRule: string
  matchHost: string
  channelUrl: string
  enabled: boolean
  createdAt: number
  provider: AlertRouteProvider
  serviceName: string | null
  /** Masked routing key (last 4 chars only) — never the raw secret. */
  routingKeyMasked: string | null
  /** Telegram target chat id (not a secret). */
  telegramChatId: string | null
  /** Masked Telegram bot token (last 4 chars only) — never the raw secret. */
  telegramBotTokenMasked: string | null
  /** ntfy topic URL (not a secret). */
  ntfyUrl: string | null
  /** Masked ntfy access token (last 4 chars only) — never the raw secret. */
  ntfyTokenMasked: string | null
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
    channelUrl?: string
    provider?: AlertRouteProvider
    serviceName?: string
    routingKey?: string
    telegramBotToken?: string
    telegramChatId?: string
    ntfyUrl?: string
    ntfyToken?: string
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

/** One PagerDuty service, for the setup dialog's picker. */
export interface PagerDutyServiceOption {
  id: string
  name: string
}

/**
 * List PagerDuty services via the account's REST API token (plan 34) — used
 * to populate the picker. Degrades to an empty list (never throws) when no
 * token is configured, so the dialog always falls back to pasting a routing
 * key by hand.
 */
export function usePagerDutyServices(enabled = true) {
  const query = useQuery({
    queryKey: ['/api/v1/health/pagerduty-services'],
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/pagerduty-services')
      await throwIfNotOk(response, 'Failed to load PagerDuty services')
      const json = (await response.json()) as {
        success: boolean
        services: PagerDutyServiceOption[]
      }
      return json.services ?? []
    },
    enabled,
    staleTime: 60_000,
  })

  return {
    services: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  }
}
