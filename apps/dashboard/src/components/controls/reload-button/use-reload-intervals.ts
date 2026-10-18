import { useCallback } from 'react'

export interface ReloadIntervalOption {
  label: string
  value: number // milliseconds
  shortcut?: string
}

export const RELOAD_INTERVALS: ReloadIntervalOption[] = [
  { label: '30s', value: 30_000, shortcut: '' },
  { label: '1m', value: 60_000, shortcut: '' },
  { label: '2m', value: 120_000, shortcut: '' },
  { label: '10m', value: 600_000, shortcut: '' },
  { label: '30m', value: 1_800_000, shortcut: '' },
]

export type ReloadIntervalValue = number | null

export interface UseReloadIntervalsOptions {
  /** Current reload interval in ms; null means auto-reload is disabled */
  reloadInterval: ReloadIntervalValue
  setReloadInterval: (interval: ReloadIntervalValue) => void
}

export interface UseReloadIntervalsReturn {
  intervals: ReloadIntervalOption[]
  setInterval: (interval: number) => void
  disableAutoReload: () => void
  isIntervalActive: (interval: number) => boolean
  isAutoReloadEnabled: boolean
}

export function useReloadIntervals({
  reloadInterval,
  setReloadInterval,
}: UseReloadIntervalsOptions): UseReloadIntervalsReturn {
  const setInterval = useCallback(
    (interval: number) => {
      setReloadInterval(interval)
    },
    [setReloadInterval]
  )

  const disableAutoReload = useCallback(() => {
    setReloadInterval(null)
  }, [setReloadInterval])

  const isIntervalActive = useCallback(
    (interval: number) => {
      return reloadInterval === interval
    },
    [reloadInterval]
  )

  return {
    intervals: RELOAD_INTERVALS,
    setInterval,
    disableAutoReload,
    isIntervalActive,
    isAutoReloadEnabled: reloadInterval != null,
  }
}
