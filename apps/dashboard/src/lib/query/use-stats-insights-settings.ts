'use client'

/**
 * useStatsInsightsSettings — per-user Statistics Insights preferences.
 *
 * Persists the anomaly-overlay settings (moving-average window, ±k·σ band
 * multiplier, absolute threshold, and the two visibility toggles) to
 * localStorage and broadcasts a CustomEvent so the settings page and the charts
 * stay in sync without a reload. Mirrors `useInsightsSettings`.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_STATS_INSIGHTS_SETTINGS,
  type StatsInsightsSettings,
  sanitizeStatsInsightsSettings,
} from '@/lib/insights/stats-settings'

const STORAGE_KEY = 'clickhouse-monitor-stats-insights-settings'
const CHANGE_EVENT = 'clickhouse-monitor-stats-insights-settings-changed'

export function getSavedStatsInsightsSettings(): StatsInsightsSettings {
  if (typeof window === 'undefined') return DEFAULT_STATS_INSIGHTS_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATS_INSIGHTS_SETTINGS
    return sanitizeStatsInsightsSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_STATS_INSIGHTS_SETTINGS
  }
}

function persist(settings: StatsInsightsSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage may be full or disabled.
  }
}

function emitChange(settings: StatsInsightsSettings): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<StatsInsightsSettings>(CHANGE_EVENT, { detail: settings })
  )
}

export interface UseStatsInsightsSettingsResult {
  readonly settings: StatsInsightsSettings
  update: (patch: Partial<StatsInsightsSettings>) => void
  reset: () => void
}

export function useStatsInsightsSettings(): UseStatsInsightsSettingsResult {
  const [settings, setSettings] = useState<StatsInsightsSettings>(
    getSavedStatsInsightsSettings
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<StatsInsightsSettings>).detail
      setSettings(detail ?? getSavedStatsInsightsSettings())
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY)
        setSettings(getSavedStatsInsightsSettings())
    }
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const update = useCallback((patch: Partial<StatsInsightsSettings>) => {
    setSettings((current) => {
      const next = sanitizeStatsInsightsSettings({ ...current, ...patch })
      persist(next)
      emitChange(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    persist(DEFAULT_STATS_INSIGHTS_SETTINGS)
    emitChange(DEFAULT_STATS_INSIGHTS_SETTINGS)
    setSettings(DEFAULT_STATS_INSIGHTS_SETTINGS)
  }, [])

  return { settings, update, reset }
}
