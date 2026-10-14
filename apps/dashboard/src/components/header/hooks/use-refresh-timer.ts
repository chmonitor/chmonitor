import { useEffect, useRef, useState } from 'react'

/**
 * Configuration options for the refresh timer hook
 */
export interface UseRefreshTimerOptions {
  /** Refresh interval in milliseconds (default: 60000) */
  interval?: number
  /** Callback fired when timer completes and refresh should occur */
  onRefresh?: () => void
  /** Whether the timer is enabled (default: true) */
  enabled?: boolean
}

/**
 * Return value of the refresh timer hook
 */
export interface UseRefreshTimerReturn {
  /** Remaining seconds until next refresh (0 when disabled) */
  remaining: number
  /** Whether the timer is currently paused */
  isPaused: boolean
  pause: () => void
  resume: () => void
  /** Reset the countdown to the initial interval */
  reset: () => void
  /** Progress value from 0-1 (useful for progress bars) */
  progress: number
}

const DEFAULT_INTERVAL = 60000 // 1 minute
const TICK_RATE = 1000 // 1 second

/**
 * Hook for managing auto-refresh countdown timer with pause/resume functionality
 *
 * @example
 * ```tsx
 * const { remaining, isPaused, pause, resume, reset, progress } = useRefreshTimer({
 *   interval: 60000,
 *   onRefresh: () => console.log('Refresh!'),
 *   enabled: true,
 * })
 * ```
 */
export function useRefreshTimer({
  interval: intervalMs = DEFAULT_INTERVAL,
  onRefresh,
  enabled = true,
}: UseRefreshTimerOptions = {}): UseRefreshTimerReturn {
  const initialSeconds = Math.floor(intervalMs / 1000)
  const [remaining, setRemaining] = useState(initialSeconds)
  const [isPaused, setIsPaused] = useState(false)

  const isRefreshingRef = useRef(false)
  const animationFrameRef = useRef<number | undefined>(undefined)

  /**
   * Reset countdown to initial value
   */
  const reset = () => {
    setRemaining(initialSeconds)
    isRefreshingRef.current = false
  }

  /**
   * Pause the countdown timer
   */
  const pause = () => {
    setIsPaused(true)
  }

  /**
   * Resume the countdown timer
   */
  const resume = () => {
    setIsPaused(false)
  }

  /**
   * Handle the refresh callback with debouncing
   */
  const triggerRefresh = () => {
    if (isRefreshingRef.current) return

    isRefreshingRef.current = true
    onRefresh?.()

    setTimeout(() => {
      isRefreshingRef.current = false
    }, 1000)
  }

  useEffect(() => {
    setRemaining(Math.floor(intervalMs / 1000))
  }, [intervalMs])

  useEffect(() => {
    if (!enabled || isPaused) {
      return
    }

    let lastTime = Date.now()

    const tick = () => {
      const now = Date.now()
      const elapsed = now - lastTime

      if (elapsed >= TICK_RATE) {
        setRemaining((prev) => {
          const next = prev - 1

          if (next <= 0) {
            // Use setTimeout to avoid state update during render
            setTimeout(() => {
              triggerRefresh()
              setRemaining(initialSeconds)
            }, 0)
            return 0
          }

          return next
        })

        lastTime = now
      }

      animationFrameRef.current = requestAnimationFrame(tick)
    }

    animationFrameRef.current = requestAnimationFrame(tick)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: React Compiler stabilizes triggerRefresh; dependency kept for correctness without the compiler.
  }, [enabled, isPaused, initialSeconds, triggerRefresh])

  // Calculate progress (0 = just started, 1 = about to refresh)
  const progress = enabled ? (initialSeconds - remaining) / initialSeconds : 0

  return {
    remaining: enabled ? remaining : 0,
    isPaused,
    pause,
    resume,
    reset,
    progress,
  }
}
