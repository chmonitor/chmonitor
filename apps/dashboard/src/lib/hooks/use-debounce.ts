import { useCallback, useEffect, useRef, useState } from 'react'

export const DEBOUNCE_DELAY = {
  /** Fast: 150ms - For lightweight operations (UI updates, local filtering) */
  FAST: 150,
  /** Default: 300ms - For typical user input (search, forms) */
  DEFAULT: 300,
  /** Slow: 500ms - For expensive operations (API calls, heavy computation) */
  SLOW: 500,
} as const

export function useDebounce<T>(
  value: T,
  delay: number = DEBOUNCE_DELAY.DEFAULT
): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = DEBOUNCE_DELAY.DEFAULT,
  deps: React.DependencyList = []
): T {
  // Store the pending timer in a ref so same-tick calls all observe the latest
  // timer id (state would be stale within a render tick) and so the returned
  // function keeps a stable identity across renders.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null
        callback(...args)
      }, delay)
    }) as T,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [callback, delay, ...deps]
  )
}

export function useDebounceWithPending<T>(
  value: T,
  delay: number = DEBOUNCE_DELAY.DEFAULT
): { debouncedValue: T; isPending: boolean } {
  const [debouncedValue, setDebouncedValue] = useState(value)

  // Derived, not state, to avoid extra renders
  const isPending = value !== debouncedValue

  useEffect(() => {
    if (value === debouncedValue) {
      return
    }

    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay, debouncedValue])

  return { debouncedValue, isPending }
}
