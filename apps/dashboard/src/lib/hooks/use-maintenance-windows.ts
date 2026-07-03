/**
 * Maintenance windows (plan 28) — client hook for the /api/v1/health/maint-windows
 * CRUD endpoint. Unlike webhook subscriptions, this feature is free/OSS and
 * does NOT require Clerk sign-in: the server resolves the caller's owner
 * (Clerk org/user when signed in, `''` OSS single-tenant otherwise) and the
 * global /api/v1 middleware already gates the request per the deployment's
 * auth posture — this hook just calls the endpoint and surfaces the result.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface MaintenanceWindowInfo {
  id: string
  ownerId: string
  hostId: number | null
  reason: string
  startsAt: number
  endsAt: number
  createdBy: string
  createdAt: number
}

export const MAINTENANCE_WINDOWS_QUERY_KEY = [
  '/api/v1/health/maint-windows',
] as const

export function useMaintenanceWindows(enabled = true) {
  const query = useQuery({
    queryKey: MAINTENANCE_WINDOWS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/maint-windows')
      await throwIfNotOk(response, 'Failed to load maintenance windows')
      const json = (await response.json()) as {
        success: boolean
        windows: MaintenanceWindowInfo[]
      }
      return json.windows ?? []
    },
    enabled,
    staleTime: 15_000,
  })

  return {
    windows: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useMaintenanceWindowsMutations() {
  const queryClient = useQueryClient()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: MAINTENANCE_WINDOWS_QUERY_KEY })

  const createWindow = async (input: {
    hostId: number | null
    reason: string
    startsAt: number
    endsAt: number
  }): Promise<MaintenanceWindowInfo> => {
    const response = await apiFetch('/api/v1/health/maint-windows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to create maintenance window')
    invalidate()
    const json = (await response.json()) as {
      success: boolean
      window: MaintenanceWindowInfo
    }
    return json.window
  }

  const deleteWindow = async (id: string): Promise<void> => {
    const response = await apiFetch(
      `/api/v1/health/maint-windows?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    await throwIfNotOk(response, 'Failed to delete maintenance window')
    invalidate()
  }

  return { createWindow, deleteWindow, invalidate }
}
