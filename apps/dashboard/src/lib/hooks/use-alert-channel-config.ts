/**
 * Unified alert channel config (feat #2665) — the client hook over
 * `/api/v1/health/alert-config`. Like `use-alert-routes.ts`, this is NOT
 * Clerk-gated: the API resolves an OSS single-tenant owner when no Clerk
 * session exists, so self-hosted deployments manage channel config with zero
 * auth. Secrets are never returned in full — only `hasSecret` + a `secretMasked`
 * preview, and an empty secret on save keeps the stored one.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export type AlertConfigChannel =
  | 'webhook'
  | 'healthchecks'
  | 'email'
  | 'opsgenie'
  | 'telegram'
  | 'ntfy'
  | 'pushover'
  | 'twilio'

export interface AlertChannelConfigInfo {
  channel: AlertConfigChannel
  enabled: boolean
  /** `null` = inherit the channel/global gate (#2661). */
  minSeverity: 'warning' | 'critical' | null
  /** Non-secret destination fields (urls, chat ids, regions, to/from, …). */
  target: Record<string, string>
  /** Whether a secret is stored (the raw secret is never returned). */
  hasSecret: boolean
  /** Masked secret preview (last 4 chars), or `null` when none is stored. */
  secretMasked: string | null
  updatedAt: number
}

export const ALERT_CHANNEL_CONFIG_QUERY_KEY = [
  '/api/v1/health/alert-config',
] as const

interface AlertConfigResponse {
  success: boolean
  configs: AlertChannelConfigInfo[]
  /** Which channels are configured via server env (for env-fallback display). */
  env: Record<AlertConfigChannel, boolean>
}

export function useAlertChannelConfig(enabled = true) {
  const query = useQuery({
    queryKey: ALERT_CHANNEL_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/alert-config')
      await throwIfNotOk(response, 'Failed to load alert channel config')
      const json = (await response.json()) as AlertConfigResponse
      return {
        configs: json.configs ?? [],
        env: json.env ?? ({} as Record<AlertConfigChannel, boolean>),
      }
    },
    enabled,
    staleTime: 30_000,
  })

  return {
    configs: query.data?.configs ?? [],
    env: query.data?.env ?? ({} as Record<AlertConfigChannel, boolean>),
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export interface UpsertChannelConfigInput {
  channel: AlertConfigChannel
  enabled: boolean
  minSeverity?: 'warning' | 'critical' | null
  target: Record<string, string>
  /** Empty / omitted = keep the stored secret. */
  secret?: string
}

export function useAlertChannelConfigMutations() {
  const queryClient = useQueryClient()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ALERT_CHANNEL_CONFIG_QUERY_KEY })

  const upsertChannel = async (
    input: UpsertChannelConfigInput
  ): Promise<AlertChannelConfigInfo> => {
    const response = await apiFetch('/api/v1/health/alert-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to save alert channel')
    invalidate()
    const json = (await response.json()) as {
      success: boolean
      config: AlertChannelConfigInfo
    }
    return json.config
  }

  const deleteChannel = async (channel: AlertConfigChannel): Promise<void> => {
    const response = await apiFetch(
      `/api/v1/health/alert-config?channel=${encodeURIComponent(channel)}`,
      { method: 'DELETE' }
    )
    await throwIfNotOk(response, 'Failed to reset alert channel')
    invalidate()
  }

  return { upsertChannel, deleteChannel, invalidate }
}
