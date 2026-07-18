/**
 * Time-window digest settings (feat #2663) — the client hook over
 * `/api/v1/health/alert-digest`. Like `use-alert-channel-config.ts`, this is NOT
 * Clerk-gated: the API resolves an OSS single-tenant owner when no Clerk session
 * exists, so self-hosted deployments manage it with zero auth.
 *
 * In-pass grouping is always on and needs no config; these settings only govern
 * the OPTIONAL time-window mode (buffer non-critical findings, flush after N
 * minutes).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface AlertDigestConfig {
  enabled: boolean
  windowMinutes: number
  /** Whether a saved D1 row exists (vs. reflecting the env fallback). */
  hasRow: boolean
  /** The `HEALTH_ALERT_DIGEST_MINUTES` env fallback value. */
  envWindowMinutes: number
}

export const ALERT_DIGEST_CONFIG_QUERY_KEY = [
  '/api/v1/health/alert-digest',
] as const

export function useAlertDigestConfig(enabled = true) {
  const query = useQuery({
    queryKey: ALERT_DIGEST_CONFIG_QUERY_KEY,
    queryFn: async (): Promise<AlertDigestConfig> => {
      const response = await apiFetch('/api/v1/health/alert-digest')
      await throwIfNotOk(response, 'Failed to load digest settings')
      const json = (await response.json()) as {
        enabled?: boolean
        windowMinutes?: number
        hasRow?: boolean
        envWindowMinutes?: number
      }
      return {
        enabled: json.enabled ?? false,
        windowMinutes: json.windowMinutes ?? 0,
        hasRow: json.hasRow ?? false,
        envWindowMinutes: json.envWindowMinutes ?? 0,
      }
    },
    enabled,
    staleTime: 30_000,
  })

  return {
    config: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useAlertDigestConfigMutation() {
  const queryClient = useQueryClient()

  const saveDigest = async (input: {
    enabled: boolean
    windowMinutes: number
  }): Promise<void> => {
    const response = await apiFetch('/api/v1/health/alert-digest', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to save digest settings')
    await queryClient.invalidateQueries({
      queryKey: ALERT_DIGEST_CONFIG_QUERY_KEY,
    })
  }

  return { saveDigest }
}
