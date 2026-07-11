import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'

import { createContext, use, useCallback, useMemo, useState } from 'react'
import {
  DEFAULT_USER_SETTINGS,
  USER_SETTINGS_STORAGE_KEY,
} from '@/lib/types/user-settings'

export interface TimeRangeOption {
  /** Display label shown in the picker (e.g., "24h") */
  label: string
  /** Unique identifier */
  value: string
  /** Number of hours of history to fetch */
  lastHours: number
  /** Recommended ClickHouse interval function for this range */
  interval: ClickHouseInterval
}

export const TIME_RANGE_PRESETS: TimeRangeOption[] = [
  { label: '1h', value: '1h', lastHours: 1, interval: 'toStartOfMinute' },
  {
    label: '6h',
    value: '6h',
    lastHours: 6,
    interval: 'toStartOfFiveMinutes',
  },
  { label: '24h', value: '24h', lastHours: 24, interval: 'toStartOfHour' },
  {
    label: '7d',
    value: '7d',
    lastHours: 24 * 7,
    interval: 'toStartOfHour',
  },
  {
    label: '30d',
    value: '30d',
    lastHours: 24 * 30,
    interval: 'toStartOfDay',
  },
]

const DEFAULT_TIME_RANGE = TIME_RANGE_PRESETS[2] // 24h

/** localStorage key for the persisted global time range */
const STORAGE_KEY = 'chm-global-time-range'
/** URL search param used to share the active time range */
const SEARCH_PARAM = 'range'

/** Resolve a stored value string against the presets; unknown -> fallback. */
function resolveTimeRange(
  value: string | null,
  fallback: TimeRangeOption = DEFAULT_TIME_RANGE
): TimeRangeOption {
  if (!value) return fallback
  return TIME_RANGE_PRESETS.find((p) => p.value === value) ?? fallback
}

/**
 * Read the user's configured default time range from the user-settings
 * localStorage blob, resolved to a preset. Used only as the initial value when
 * no explicit range (URL param or previously-persisted click) is present, so it
 * never overrides an explicit user choice. Falls back to the hard default
 * (24h) when unset or unparseable.
 */
function readSettingsDefault(): TimeRangeOption {
  try {
    const raw = localStorage.getItem(USER_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_TIME_RANGE
    const parsed = JSON.parse(raw) as { defaultTimeRange?: string }
    return resolveTimeRange(
      parsed.defaultTimeRange ?? DEFAULT_USER_SETTINGS.defaultTimeRange
    )
  } catch {
    return DEFAULT_TIME_RANGE
  }
}

/**
 * Read the initial time range, preferring the URL `?range=` param, then the
 * previously-persisted range (an explicit user click), then the user's
 * configured default-time-range setting, then the hard default. Wrapped in
 * try/catch for SSR and private-browsing safety.
 */
function readInitialTimeRange(): TimeRangeOption {
  if (typeof window === 'undefined') return DEFAULT_TIME_RANGE
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(
      SEARCH_PARAM
    )
    if (fromUrl) return resolveTimeRange(fromUrl)

    const persisted = localStorage.getItem(STORAGE_KEY)
    if (persisted) return resolveTimeRange(persisted)

    return readSettingsDefault()
  } catch {
    return DEFAULT_TIME_RANGE
  }
}

/** Persist the selected range to localStorage and the URL search param. */
function persistTimeRange(option: TimeRangeOption): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, option.value)
  } catch {
    // localStorage may be full or unavailable (e.g. private browsing)
  }
  try {
    const url = new URL(window.location.href)
    url.searchParams.set(SEARCH_PARAM, option.value)
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // history API may be unavailable in some embedded contexts
  }
}

interface TimeRangeContextValue {
  timeRange: TimeRangeOption
  setTimeRange: (option: TimeRangeOption) => void
  presets: TimeRangeOption[]
}

const TimeRangeContext = createContext<TimeRangeContextValue>({
  timeRange: DEFAULT_TIME_RANGE,
  setTimeRange: () => {},
  presets: TIME_RANGE_PRESETS,
})

export function TimeRangeProvider({ children }: { children: React.ReactNode }) {
  const [timeRange, setTimeRangeState] =
    useState<TimeRangeOption>(readInitialTimeRange)

  const setTimeRange = useCallback((option: TimeRangeOption) => {
    setTimeRangeState(option)
    persistTimeRange(option)
  }, [])

  const value = useMemo<TimeRangeContextValue>(
    () => ({ timeRange, setTimeRange, presets: TIME_RANGE_PRESETS }),
    [timeRange, setTimeRange]
  )

  return (
    <TimeRangeContext.Provider value={value}>
      {children}
    </TimeRangeContext.Provider>
  )
}

export function useTimeRange(): TimeRangeContextValue {
  return use(TimeRangeContext)
}
