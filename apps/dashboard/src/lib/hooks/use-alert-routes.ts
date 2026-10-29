/**
 * Not Clerk-gated: the API resolves an OSS single-tenant owner id when no
 * Clerk session exists (see `lib/health/alert-routing-auth.ts`).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { HealthDefinitionSource } from '@/lib/health/declarative/merge'

import { useCloudAccess } from '@/lib/cloud/use-cloud-access'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export type AlertRouteProvider =
  | 'webhook'
  | 'pagerduty'
  | 'telegram'
  | 'ntfy'
  | 'pushover'
  | 'matrix'

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
  /** Pushover target user/group key (not a secret). */
  pushoverUser: string | null
  /** Masked Pushover application token (last 4 chars only) — never the raw secret. */
  pushoverTokenMasked: string | null
  /** Matrix homeserver base URL (not a secret). */
  matrixHomeserverUrl: string | null
  /** Matrix room id (not a secret). */
  matrixRoomId: string | null
  /** Masked Matrix access token (last 4 chars only) — never the raw secret. */
  matrixAccessTokenMasked: string | null
  /** Slack channel id for bot delivery on a Slack webhook route (not a secret). */
  slackChannelId: string | null
  /** Per-route severity floor; `null` = inherit the channel/global gate. */
  minSeverity: 'warning' | 'critical' | null
  /** `file`/`env` definitions are read-only; absent = `d1`. */
  source?: HealthDefinitionSource
}

export const ALERT_ROUTES_QUERY_KEY = ['/api/v1/health/routes'] as const

export function useAlertRoutes(enabled = true) {
  const canRead = useCloudAccess() === 'open'
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
    enabled: enabled && canRead,
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
    pushoverToken?: string
    pushoverUser?: string
    matrixHomeserverUrl?: string
    matrixAccessToken?: string
    matrixRoomId?: string
    slackChannelId?: string
    minSeverity?: 'warning' | 'critical'
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

export interface PagerDutyServiceOption {
  id: string
  name: string
}

/**
 * Degrades to an empty list (never throws) when no
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
