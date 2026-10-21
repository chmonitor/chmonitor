import { type ComponentPropsWithoutRef, useRef } from 'react'
import { useInViewport } from '@/lib/hooks/use-in-viewport'
import { ChartViewportContext } from '@/lib/query/chart-viewport'

/**
 * A plain `div` (pass the grid cell's own className/style, so layout is
 * identical) that tells the charts inside whether it is in or near the
 * viewport. Off-screen cells stop auto-refreshing; see `ChartViewportContext`.
 */
export function ChartViewportBoundary(props: ComponentPropsWithoutRef<'div'>) {
  const ref = useRef<HTMLDivElement>(null)
  const inViewport = useInViewport(ref)
  return (
    <ChartViewportContext.Provider value={inViewport}>
      <div ref={ref} {...props} />
    </ChartViewportContext.Provider>
  )
}
