import * as React from 'react'

export const MOBILE_BREAKPOINT = 768
// Tailwind `lg` breakpoint — used to default collapsible panels (e.g. the
// agents page conversation rail) closed on tablet-sized viewports too, not
// just phones. The app sidebar also overlays (sheet) below this width so a
// persistent dock cannot crush the overview card grid at 768 / landscape.
export const LG_BREAKPOINT = 1024

/**
 * Server and prerender snapshot: never below a breakpoint. The static shell is
 * built with the desktop layout, so hydration starts from it. On a phone React
 * swaps to the real value in the same pass; the first client-only render
 * (SPA navigation, lazy chunk) already reads the real value.
 */
const SERVER_SNAPSHOT = false

function useBreakpointDown(breakpoint: number) {
  const query = `(max-width: ${breakpoint - 1}px)`
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query]
  )
  const getSnapshot = React.useCallback(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia(query).matches,
    [query]
  )
  return React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SERVER_SNAPSHOT
  )
}

export function useIsMobile() {
  return useBreakpointDown(MOBILE_BREAKPOINT)
}

/** True below the `lg` breakpoint (covers phones and tablets). */
export function useIsLgDown() {
  return useBreakpointDown(LG_BREAKPOINT)
}
