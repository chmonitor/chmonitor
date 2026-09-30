/**
 * Built-in check alerts (#3438): the operator's display name per built-in
 * alert, keyed by the stable check id (= `alert_state` / ACK `ruleId`).
 *
 * `GET /api/v1/health/check-alerts` always answers (defaults with no metadata
 * DB), so the list and name resolution work read-only. Rename / reset are
 * write controls — gate them on `useHealthStoreAvailability`.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useCallback, useMemo } from 'react'
import { HEALTH_CHECKS } from '@/components/health/health-checks'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface CheckAlertInfo {
  checkId: string
  /** Always equal to `checkId`. */
  ruleId: string
  name: string
  defaultName: string
  source: 'default' | 'd1'
  updatedAt: number | null
}

export const CHECK_ALERTS_QUERY_KEY = ['/api/v1/health/check-alerts'] as const

const BROWSER_TITLES: ReadonlyMap<string, string> = new Map(
  HEALTH_CHECKS.map((check) => [check.id, check.title])
)

/**
 * Display name for a rule id: the stored/default name from the API, else the
 * caller's own label (e.g. a custom rule's title), else the browser check's
 * title (API not answered yet), else the raw id.
 */
export function resolveCheckAlertName(
  ruleId: string,
  byId: ReadonlyMap<string, CheckAlertInfo>,
  fallback?: string
): string {
  return (
    byId.get(ruleId)?.name ?? fallback ?? BROWSER_TITLES.get(ruleId) ?? ruleId
  )
}

export type CheckAlertNameResolver = (
  ruleId: string,
  fallback?: string
) => string

export function useCheckAlerts() {
  const query = useQuery({
    queryKey: CHECK_ALERTS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/check-alerts')
      await throwIfNotOk(response, 'Failed to load check alerts')
      const json = (await response.json()) as {
        success: boolean
        data: CheckAlertInfo[]
      }
      return json.data ?? []
    },
    staleTime: 60_000,
  })

  return {
    alerts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/** One shared resolver for every surface that shows alerts by `ruleId`. */
export function useCheckAlertNames(): CheckAlertNameResolver {
  const { alerts } = useCheckAlerts()
  const byId = useMemo(
    () => new Map(alerts.map((alert) => [alert.ruleId, alert])),
    [alerts]
  )
  return useCallback<CheckAlertNameResolver>(
    (ruleId, fallback) => resolveCheckAlertName(ruleId, byId, fallback),
    [byId]
  )
}

export function useCheckAlertsMutations() {
  const queryClient = useQueryClient()

  const store = (updated: CheckAlertInfo) => {
    queryClient.setQueryData<CheckAlertInfo[]>(CHECK_ALERTS_QUERY_KEY, (prev) =>
      prev?.map((a) => (a.checkId === updated.checkId ? updated : a))
    )
  }

  const send = async (
    checkId: string,
    init: RequestInit,
    fallback: string
  ): Promise<CheckAlertInfo> => {
    const response = await apiFetch(
      `/api/v1/health/check-alerts/${encodeURIComponent(checkId)}`,
      init
    )
    await throwIfNotOk(response, fallback)
    const json = (await response.json()) as {
      success: boolean
      data: CheckAlertInfo
    }
    store(json.data)
    return json.data
  }

  const renameCheckAlert = (checkId: string, name: string) =>
    send(
      checkId,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      },
      'Failed to rename alert'
    )

  const resetCheckAlert = (checkId: string) =>
    send(checkId, { method: 'DELETE' }, 'Failed to reset alert name')

  return { renameCheckAlert, resetCheckAlert }
}
