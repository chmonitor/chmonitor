import { useEffect, useRef } from 'react'

/**
 * Runs `callback` every `delayMs` while the document is visible. The interval
 * stops while the tab is hidden, and on becoming visible the callback runs once
 * right away so the UI catches up without waiting for the next tick.
 */
export function useVisibleInterval(
  callback: () => void,
  delayMs: number
): void {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const start = () => {
      if (timer === undefined) {
        timer = setInterval(() => callbackRef.current(), delayMs)
      }
    }
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop()
        return
      }
      callbackRef.current()
      start()
    }

    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, [delayMs])
}
