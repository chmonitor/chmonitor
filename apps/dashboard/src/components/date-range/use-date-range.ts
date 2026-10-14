import type { DateRangeConfig, DateRangeValue } from './date-range-types'

import { useState } from 'react'

interface UseDateRangeOptions {
  config: DateRangeConfig
  /** Override initial value (instead of config.defaultValue) */
  initialValue?: string
  onRangeChange?: (range: DateRangeValue) => void
}

interface UseDateRangeReturn {
  /** Current selected value (e.g., "24h") */
  value: string
  /** Current lastHours number (undefined for "all" range) */
  lastHours?: number
  interval: string
  range: DateRangeValue
  setRange: (range: DateRangeValue) => void
  reset: () => void
}

/**
 * Hook for managing date range state
 *
 * Provides local state management that works with query caching.
 * Different lastHours values create different cache keys, enabling
 * instant switching back to previously-fetched ranges.
 *
 * @example
 * ```tsx
 * const { lastHours, interval, setRange } = useDateRange({
 *   config: DATE_RANGE_PRESETS.standard,
 * })
 *
 * const swr = useChartData({
 *   chartName: 'query-count',
 *   hostId,
 *   lastHours,
 *   interval,
 * })
 * ```
 */
export function useDateRange({
  config,
  initialValue,
  onRangeChange,
}: UseDateRangeOptions): UseDateRangeReturn {
  const defaultOption = (() => {
    const targetValue = initialValue ?? config.defaultValue
    return (
      config.options.find((o) => o.value === targetValue) ?? config.options[0]
    )
  })()

  const [range, setRangeState] = useState<DateRangeValue>({
    value: defaultOption.value,
    lastHours: defaultOption.lastHours,
    interval: defaultOption.interval,
  })

  const setRange = (newRange: DateRangeValue) => {
    setRangeState(newRange)
    onRangeChange?.(newRange)
  }

  const reset = () => {
    const resetRange: DateRangeValue = {
      value: defaultOption.value,
      lastHours: defaultOption.lastHours,
      interval: defaultOption.interval,
    }
    setRangeState(resetRange)
    onRangeChange?.(resetRange)
  }

  return {
    value: range.value,
    lastHours: range.lastHours,
    interval: range.interval,
    range,
    setRange,
    reset,
  }
}
