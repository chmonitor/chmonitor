import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useCallback } from 'react'
import { apiFetch } from '@/lib/swr/api-fetch'
import {
  DEFAULT_USER_SETTINGS,
  mergeUserSettings,
  USER_SETTINGS_STORAGE_KEY,
  type UserSettings,
} from '@/lib/types/user-settings'

/**
 * Shared cache key. `MenuItem` / `SubMenuItem` call this hook once per
 * navigation entry; one query key dedupes what would otherwise be 8-16
 * concurrent settings requests per page load.
 */
export const USER_SETTINGS_QUERY_KEY = ['user-settings'] as const

/** Returns null if backend is unavailable or has no custom defaults. */
async function fetchBackendDefaults(): Promise<Partial<UserSettings> | null> {
  try {
    const response = await apiFetch('/api/v1/dashboard/settings?hostId=0')
    if (!response.ok) return null

    const data = (await response.json()) as {
      success?: boolean
      data?: { params?: Record<string, string> }
    }

    if (data.success && data.data?.params) {
      const { params } = data.data
      const defaults: Partial<UserSettings> = {}

      if (params.timezone && typeof params.timezone === 'string') {
        defaults.timezone = params.timezone
      }

      if (params.theme && typeof params.theme === 'string') {
        defaults.theme = params.theme as UserSettings['theme']
      }

      return defaults
    }
  } catch (error) {
    console.warn('Failed to fetch backend defaults:', error)
  }
  return null
}

function loadSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_USER_SETTINGS

  try {
    const stored = localStorage.getItem(USER_SETTINGS_STORAGE_KEY)
    if (stored) {
      return mergeUserSettings(JSON.parse(stored))
    }
  } catch (error) {
    console.error('Failed to load user settings:', error)
  }

  return DEFAULT_USER_SETTINGS
}

function saveSettings(settings: UserSettings): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save user settings:', error)
  }
}

/**
 * Resolve the effective settings: locally stored values win outright; only a
 * first-run browser (nothing in localStorage) consults the backend defaults.
 */
export async function resolveUserSettings(): Promise<UserSettings> {
  const stored = loadSettings()

  if (
    typeof window !== 'undefined' &&
    !localStorage.getItem(USER_SETTINGS_STORAGE_KEY)
  ) {
    const backendDefaults = await fetchBackendDefaults()
    if (backendDefaults) {
      const merged = { ...DEFAULT_USER_SETTINGS, ...backendDefaults }
      saveSettings(merged)
      return merged
    }
  }

  return stored
}

export function useUserSettings() {
  const queryClient = useQueryClient()

  const { data, isPending } = useQuery({
    queryKey: USER_SETTINGS_QUERY_KEY,
    queryFn: resolveUserSettings,
    // Settings only ever change through `updateSettings`, which writes straight
    // into the cache — there is nothing to revalidate against.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    // localStorage does not exist during SSR; staying disabled keeps the first
    // render identical to the server output.
    enabled: typeof window !== 'undefined',
  })

  const updateSettings = useCallback(
    (updates: Partial<UserSettings>) => {
      queryClient.setQueryData<UserSettings>(
        USER_SETTINGS_QUERY_KEY,
        (current) => {
          const next = { ...(current ?? DEFAULT_USER_SETTINGS), ...updates }
          saveSettings(next)
          return next
        }
      )
    },
    [queryClient]
  )

  return {
    settings: data ?? DEFAULT_USER_SETTINGS,
    updateSettings,
    // False until client-side resolution lands, so hydration-sensitive
    // consumers avoid rendering stored values on the server pass.
    mounted: !isPending && data !== undefined,
  }
}
