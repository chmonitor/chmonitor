import { useInterval } from 'usehooks-ts'

import { useEffect, useState } from 'react'

export interface ReloadCountdownOptions {
  /**
   * Auto-reload interval in milliseconds
   * null means auto-reload is disabled
   */
  reloadInterval: number | null
  onCountdownComplete: () => void
  /**
   * Whether a reload operation is currently in progress
   * When true, the countdown timer is paused
   */
  isLoading?: boolean
}

export interface ReloadCountdownReturn {
  countDown: number
  resetCountDown: () => void
}

const DEFAULT_COUNTDOWN_SECONDS = 10

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
    !isLoading && reloadInterval != null ? 1000 : null
  )

  return {
    countDown,
    resetCountDown,
  }
}
