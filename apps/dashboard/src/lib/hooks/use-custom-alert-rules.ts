/**
 * Custom alert rules (plan 32). Unlike webhook subscriptions this works on
 * self-hosted without Clerk too — the API falls back to a fixed
 * single-tenant owner id server-side (`resolveCustomRuleOwnerId`), so the
 * query is always enabled.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface CustomAlertRuleInfo {
  id: string
  name: string
  metric: string
  op: '>' | '>=' | '<' | '<='
  warning: number
  critical: number
  enabled: boolean
  createdAt: number
}

export interface MetricCatalogEntryInfo {
  key: string
  label: string
  unit: string
}

export const CUSTOM_ALERT_RULES_QUERY_KEY = [
  '/api/v1/health/custom-rules',
] as const

export function useMetricCatalog() {
  const query = useQuery({
    queryKey: ['/api/v1/health/custom-rules', 'catalog'],
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/custom-rules?catalog=1')
      await throwIfNotOk(response, 'Failed to load metric catalog')
      const json = (await response.json()) as {
        success: boolean
        data: MetricCatalogEntryInfo[]
      }
      return json.data ?? []
    },
    staleTime: Number.POSITIVE_INFINITY, // static server-side catalog
  })

  return { catalog: query.data ?? [], isLoading: query.isLoading }
}

export function useCustomAlertRules() {
  const query = useQuery({
    queryKey: CUSTOM_ALERT_RULES_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/custom-rules')
      await throwIfNotOk(response, 'Failed to load custom alert rules')
      const json = (await response.json()) as {
        success: boolean
        data: CustomAlertRuleInfo[]
      }
      return json.data ?? []
    },
    staleTime: 30_000,
  })

  return {
    rules: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useCustomAlertRulesMutations() {
  const queryClient = useQueryClient()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: CUSTOM_ALERT_RULES_QUERY_KEY })

  const createRule = async (input: {
    name: string
    metric: string
    op: string
    warning: number
    critical: number
  }): Promise<CustomAlertRuleInfo> => {
    const response = await apiFetch('/api/v1/health/custom-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to create custom alert rule')
    invalidate()
    const json = (await response.json()) as {
      success: boolean
      data: CustomAlertRuleInfo
    }
    return json.data
  }

  const deleteRule = async (id: string): Promise<void> => {
    const response = await apiFetch(
      `/api/v1/health/custom-rules/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    await throwIfNotOk(response, 'Failed to delete custom alert rule')
    invalidate()
  }

  const testMetric = async (
    metric: string,
    hostId = 0
  ): Promise<{ metric: string; value: number | null; unit: string }> => {
    const response = await apiFetch(
      `/api/v1/health/custom-rules/test?metric=${encodeURIComponent(metric)}&hostId=${hostId}`
    )
    await throwIfNotOk(response, 'Failed to test metric')
    const json = (await response.json()) as {
      success: boolean
      data: { metric: string; value: number | null; unit: string }
    }
    return json.data
  }

  return { createRule, deleteRule, testMetric, invalidate }
}
