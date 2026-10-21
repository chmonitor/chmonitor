import { type RefObject, useEffect, useRef, useState } from 'react'

/**
 * Margin around the viewport inside which an element still counts as visible,
 * so a card a little below the fold refreshes before it scrolls in.
 */
export const IN_VIEWPORT_ROOT_MARGIN = '200px 0px'

/**
 * Whether the element behind `ref` is in (or near) the viewport.
 *
 * Fails open: returns `true` until the observer reports otherwise and when
 * `IntersectionObserver` is unavailable (SSR, tests), so polling is never
 * paused by accident.
 */
export function useInViewport(
  ref: RefObject<Element | null>,
  rootMargin: string = IN_VIEWPORT_ROOT_MARGIN
): boolean {
  const [inViewport, setInViewport] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1]
        if (last) setInViewport(last.isIntersecting)
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rootMargin])

  return inViewport
}

/**
 * Like `visibilityAwareInterval`, but also pauses while `active` is false
 * (for example an off-screen card). Only the refetch interval is paused; the
 * initial fetch and cached data are untouched.
 */
export function pausableInterval(
  ms: number,
  active: boolean
): () => number | false {
  return () =>
    active && !(typeof document !== 'undefined' && document.hidden) ? ms : false
}

/**
 * Keeps data from going stale while polling is paused. When `active` turns
 * true again, refetches once the data is `intervalMs` old: immediately if it
 * already is, otherwise after the remaining time (the query's own interval
 * restarts from scratch on resume, so without this the data could be almost
 * two intervals old). Never fires while `active` stays true, so the cadence of
 * an always-visible card is unchanged.
 */
export function useRefetchOnResume(
  active: boolean,
  dataUpdatedAt: number,
  intervalMs: number,
  refetch: () => unknown
): void {
  const wasActive = useRef(active)
  const latest = useRef({ dataUpdatedAt, refetch })
  latest.current = { dataUpdatedAt, refetch }

  useEffect(() => {
    const resumed = active && !wasActive.current
    wasActive.current = active
    if (!resumed || !(intervalMs > 0)) return
    const { dataUpdatedAt: updatedAt } = latest.current
    if (!updatedAt) return
    const remaining = Math.max(0, intervalMs - (Date.now() - updatedAt))
    const timer = setTimeout(() => latest.current.refetch(), remaining)
    return () => clearTimeout(timer)
  }, [active, intervalMs])
}
