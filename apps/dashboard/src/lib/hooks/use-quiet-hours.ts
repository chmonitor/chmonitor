import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { HealthDefinitionSource } from '@/lib/health/declarative/merge'

import { useCloudAccess } from '@/lib/cloud/use-cloud-access'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

export interface QuietHoursInfo {
  id: string
  ownerId: string
  days: number[]
  start: string
  end: string
  timezone: string
  severityCap: 'critical' | null
  createdBy: string
  createdAt: number
  /** `file`/`env` definitions are read-only; absent = `d1`. */
  source?: HealthDefinitionSource
}

export const QUIET_HOURS_QUERY_KEY = ['/api/v1/health/quiet-hours'] as const

export function useQuietHours(enabled = true) {
  const canRead = useCloudAccess() === 'open'
  const query = useQuery({
    queryKey: QUIET_HOURS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch('/api/v1/health/quiet-hours')
      await throwIfNotOk(response, 'Failed to load quiet hours')
      const json = (await response.json()) as {
        success: boolean
        windows: QuietHoursInfo[]
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

export function useQuietHoursMutations() {
  const queryClient = useQueryClient()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: QUIET_HOURS_QUERY_KEY })

  const createWindow = async (input: {
    days: number[]
    start: string
    end: string
    timezone: string
    severityCap: 'critical' | null
  }): Promise<QuietHoursInfo> => {
    const response = await apiFetch('/api/v1/health/quiet-hours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await throwIfNotOk(response, 'Failed to create quiet-hours window')
    invalidate()
    const json = (await response.json()) as {
      success: boolean
      window: QuietHoursInfo
    }
    return json.window
  }

  const deleteWindow = async (id: string): Promise<void> => {
    const response = await apiFetch(
      `/api/v1/health/quiet-hours?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    await throwIfNotOk(response, 'Failed to delete quiet-hours window')
    invalidate()
  }

  return { createWindow, deleteWindow, invalidate }
}
