'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_INSIGHTS_SETTINGS,
  type InsightsSettings,
  sanitizeInsightsSettings,
} from '@/lib/insights/settings'

const STORAGE_KEY = 'clickhouse-monitor-insights-settings'
const CHANGE_EVENT = 'clickhouse-monitor-insights-settings-changed'

export function getSavedInsightsSettings(): InsightsSettings {
  if (typeof window === 'undefined') return DEFAULT_INSIGHTS_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_INSIGHTS_SETTINGS
    return sanitizeInsightsSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_INSIGHTS_SETTINGS
  }
}

function persist(settings: InsightsSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage may be full or disabled.
  }
}

function emitChange(settings: InsightsSettings): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<InsightsSettings>(CHANGE_EVENT, { detail: settings })
  )
}

export interface UseInsightsSettingsResult {
  readonly settings: InsightsSettings
  update: (patch: Partial<InsightsSettings>) => void
  reset: () => void
}

export function useInsightsSettings(): UseInsightsSettingsResult {
  const [settings, setSettings] = useState<InsightsSettings>(
    getSavedInsightsSettings
  )

  // Keep in sync with other consumers + other tabs.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<InsightsSettings>).detail
      setSettings(detail ?? getSavedInsightsSettings())
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setSettings(getSavedInsightsSettings())
    }
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const update = useCallback((patch: Partial<InsightsSettings>) => {
    setSettings((current) => {
      const next = sanitizeInsightsSettings({ ...current, ...patch })
      persist(next)
      emitChange(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    persist(DEFAULT_INSIGHTS_SETTINGS)
    emitChange(DEFAULT_INSIGHTS_SETTINGS)
    setSettings(DEFAULT_INSIGHTS_SETTINGS)
  }, [])

  return { settings, update, reset }
}
