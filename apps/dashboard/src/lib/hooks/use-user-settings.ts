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
 * Shared cache key for the resolved user settings.
 *
 * The settings are read by many components at once — notably `MenuItem` /
 * `SubMenuItem`, which call this hook *once per navigation entry*. Routing the
 * resolution through TanStack Query under a single key is what collapses that
 * fan-out: previously every caller ran its own `useEffect` + `apiFetch`, which
 * fired 8-16 concurrent `GET /api/v1/dashboard/settings` on a single page load
 * (measured on the cloud demo) because a plain `useState` hook has no request
 * deduplication and no shared cache.
 */
export const USER_SETTINGS_QUERY_KEY = ['user-settings'] as const

/**
 * Fetch default settings from backend API
 * Returns null if backend is unavailable or has no custom defaults
 */
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

      // Extract timezone from backend params if available
      if (params.timezone && typeof params.timezone === 'string') {
        defaults.timezone = params.timezone
      }

      // Extract theme from backend params if available
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
 * Extracted so it can run as a query function — identical logic to the previous
 * in-effect implementation.
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
    // localStorage does not exist during SSR. Keeping the query disabled on the
    // server preserves the previous behaviour, where resolution happened in a
    // client-only effect and the first render always matched the server output.
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
    // Mirrors the previous flag: false until the client-side resolution lands,
    // so hydration-sensitive consumers still avoid rendering stored values on
    // the server pass.
    mounted: !isPending && data !== undefined,
  }
}
