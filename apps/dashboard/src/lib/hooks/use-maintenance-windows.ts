import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { HealthDefinitionSource } from '@/lib/health/declarative/merge'

import { useCloudAccess } from '@/lib/cloud/use-cloud-access'
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
  /** `file`/`env` definitions are read-only; absent = `d1`. */
  source?: HealthDefinitionSource
}

export const MAINTENANCE_WINDOWS_QUERY_KEY = [
  '/api/v1/health/maint-windows',
] as const

export function useMaintenanceWindows(enabled = true) {
  const canRead = useCloudAccess() === 'open'
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
    enabled: enabled && canRead,
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
