import * as React from 'react'

const MOBILE_BREAKPOINT = 768
// Tailwind `lg` breakpoint — used to default collapsible panels (e.g. the
// agents page conversation rail) closed on tablet-sized viewports too, not
// just phones.
const LG_BREAKPOINT = 1024

function useBreakpointDown(breakpoint: number) {
  const [isBelow, setIsBelow] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = () => {
      setIsBelow(window.innerWidth < breakpoint)
    }
    mql.addEventListener('change', onChange)
    setIsBelow(window.innerWidth < breakpoint)
    return () => mql.removeEventListener('change', onChange)
  }, [breakpoint])

  return !!isBelow
}

export function useIsMobile() {
  return useBreakpointDown(MOBILE_BREAKPOINT)
}

/** True below the `lg` breakpoint (covers phones and tablets). */
export function useIsLgDown() {
  return useBreakpointDown(LG_BREAKPOINT)
}
