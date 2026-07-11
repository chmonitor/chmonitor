import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/swr/api-fetch'
import {
  DEFAULT_USER_SETTINGS,
  mergeUserSettings,
  USER_SETTINGS_STORAGE_KEY,
  type UserSettings,
} from '@/lib/types/user-settings'

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

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS)
  const [mounted, setMounted] = useState(false)

  // Load from localStorage after hydration, with backend defaults as fallback
  useEffect(() => {
    async function loadSettingsWithDefaults() {
      const stored = loadSettings()

      // If no stored settings, try to fetch defaults from backend
      if (!localStorage.getItem(USER_SETTINGS_STORAGE_KEY)) {
        const backendDefaults = await fetchBackendDefaults()
        if (backendDefaults) {
          const mergedSettings = {
            ...DEFAULT_USER_SETTINGS,
            ...backendDefaults,
          }
          setSettings(mergedSettings)
          saveSettings(mergedSettings)
          setMounted(true)
          return
        }
      }

      setSettings(stored)
      setMounted(true)
    }

    loadSettingsWithDefaults()
  }, [])

  const updateSettings = (updates: Partial<UserSettings>) => {
    const newSettings = { ...settings, ...updates }
    setSettings(newSettings)
    saveSettings(newSettings)
  }

  return { settings, updateSettings, mounted }
}
