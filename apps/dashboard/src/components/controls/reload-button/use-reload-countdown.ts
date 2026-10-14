import { useInterval } from 'usehooks-ts'

import { useEffect, useState } from 'react'

export interface ReloadCountdownOptions {
  /**
   * Auto-reload interval in milliseconds
   * null means auto-reload is disabled
   */
  reloadInterval: number | null
  /**
   * Callback triggered when countdown reaches zero
   */
  onCountdownComplete: () => void
  /**
   * Whether a reload operation is currently in progress
   * When true, the countdown timer is paused
   */
  isLoading?: boolean
}

export interface ReloadCountdownReturn {
  /**
   * Current countdown value in seconds
   */
  countDown: number
  /**
   * Manually reset the countdown to initial value
   */
  resetCountDown: () => void
}

const DEFAULT_COUNTDOWN_SECONDS = 10

/**
 * Custom hook for managing auto-reload countdown timer
 *
 * @example
 * ```tsx
 * const { countDown, resetCountDown } = useReloadCountdown({
 *   reloadInterval: 30000,
 *   onCountdownComplete: () => router.refresh(),
 *   isLoading: false,
 * })
 * ```
 */
export function useReloadCountdown({
  reloadInterval,
  onCountdownComplete,
  isLoading = false,
}: ReloadCountdownOptions): ReloadCountdownReturn {
  const initialCountDown =
    reloadInterval != null ? reloadInterval / 1000 : DEFAULT_COUNTDOWN_SECONDS

  const [countDown, setCountDown] = useState(initialCountDown)

  useEffect(() => {
    if (reloadInterval != null) {
      setCountDown(reloadInterval / 1000)
    }
  }, [reloadInterval])

  const resetCountDown = () => {
    setCountDown(initialCountDown)
  }

  useInterval(
    () => {
      if (countDown <= 1) {
        onCountdownComplete()
        resetCountDown()
      } else {
        setCountDown((prev) => prev - 1)
      }
    },
    // Only run interval if:
    // - Not currently loading
    // - Auto-reload is enabled (reloadInterval != null)
    !isLoading && reloadInterval != null ? 1000 : null
  )

  return {
    countDown,
    resetCountDown,
  }
}
