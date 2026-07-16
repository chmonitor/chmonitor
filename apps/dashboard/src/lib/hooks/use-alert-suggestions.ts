/**
 * Smart alert suggestions (issue #2667). Like custom rules this works
 * self-hosted without Clerk too — the API resolves a fixed single-tenant owner
 * id server-side, so the query is always enabled. GET is 501-tolerant (surfaced
 * so the panel can show a "requires a database backend" note, mirroring the
 * rule builder).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { CUSTOM_ALERT_RULES_QUERY_KEY } from './use-custom-alert-rules'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export type SuggestionSource =
  | 'recurring-finding'
  | 'baseline'
  | 'near-threshold'
  | 'cluster-shape'

export interface AlertSuggestionInfo {
  key: string
  metric: string
  title: string
  reason: string
  source: SuggestionSource
  op: '>' | '>=' | '<' | '<='
  warning: number
  critical: number
  unit: string
  hostId: number
  hostName: string
  currentValue: number | null
}

export const ALERT_SUGGESTIONS_QUERY_KEY = [
  '/api/v1/health/alert-suggestions',
] as const

export function useAlertSuggestions() {
  const query = useQuery({
    queryKey: ALERT_SUGGESTIONS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/alert-suggestions')
      await throwIfNotOk(response, 'Failed to load alert suggestions')
      const json = (await response.json()) as {
        success: boolean
        data: AlertSuggestionInfo[]
      }
      return json.data ?? []
    },
    staleTime: 60_000,
  })

  return {
    suggestions: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useAlertSuggestionMutations() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ALERT_SUGGESTIONS_QUERY_KEY })
    // Accepting a suggestion creates a custom rule — keep that list fresh too.
    queryClient.invalidateQueries({ queryKey: CUSTOM_ALERT_RULES_QUERY_KEY })
  }

  const acceptSuggestion = async (input: {
    name: string
    metric: string
    op: string
    warning: number
    critical: number
  }): Promise<void> => {
    const response = await apiFetch('/api/v1/health/alert-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept', ...input }),
    })
    await throwIfNotOk(response, 'Failed to accept suggestion')
    invalidate()
  }

  const dismissSuggestion = async (key: string): Promise<void> => {
    const response = await apiFetch('/api/v1/health/alert-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss', key }),
    })
    await throwIfNotOk(response, 'Failed to dismiss suggestion')
    invalidate()
  }

  return { acceptSuggestion, dismissSuggestion, invalidate }
}
