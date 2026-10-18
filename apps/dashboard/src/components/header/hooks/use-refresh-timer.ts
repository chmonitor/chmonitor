import { useEffect, useRef, useState } from 'react'

export interface UseRefreshTimerOptions {
  interval?: number
  onRefresh?: () => void
  enabled?: boolean
}

export interface UseRefreshTimerReturn {
  remaining: number
  isPaused: boolean
  pause: () => void
  resume: () => void
  reset: () => void
  progress: number
}

const DEFAULT_INTERVAL = 60000 // 1 minute
const TICK_RATE = 1000 // 1 second

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

  const reset = () => {
    setRemaining(initialSeconds)
    isRefreshingRef.current = false
  }

  const pause = () => {
    setIsPaused(true)
  }

  const resume = () => {
    setIsPaused(false)
  }

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
