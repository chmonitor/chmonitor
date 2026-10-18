import type { DateRangeConfig, DateRangeValue } from './date-range-types'

import { useState } from 'react'

interface UseDateRangeOptions {
  config: DateRangeConfig
  initialValue?: string
  onRangeChange?: (range: DateRangeValue) => void
}

interface UseDateRangeReturn {
  value: string
  lastHours?: number
  interval: string
  range: DateRangeValue
  setRange: (range: DateRangeValue) => void
  reset: () => void
}

/**
 * Local date range state. Each lastHours value is its own query cache key, so
 * switching back to a fetched range is instant.
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
