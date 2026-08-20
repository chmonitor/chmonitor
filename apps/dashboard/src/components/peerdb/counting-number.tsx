import { pdbFmtNum } from './peerdb-utils'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const ANIMATION_DURATION = 700

function easeOutQuad(t: number): number {
  return t * (2 - t)
}

interface CountingNumberProps {
  value: number
  /** Still aggregating — pulse so the operator can see the total is in flight. */
  counting?: boolean
  /** Last-known snapshot, not this session's live fetch. */
  cached?: boolean
  format?: (n: number) => string
  className?: string
}

/**
 * Animates a KPI from its previous value to `value`, formatting with
 * `pdbFmtNum` so compact suffixes (18.4M) stay stable while the underlying
 * count is still climbing.
 */
export function CountingNumber({
  value,
  counting,
  cached,
  format = pdbFmtNum,
  className,
}: CountingNumberProps) {
  const target = Number.isFinite(value) ? value : 0
  const [display, setDisplay] = useState(target)
  const prevRef = useRef(target)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const prev = prevRef.current
    if (prev === target) {
      setDisplay(target)
      return
    }

    const start = performance.now()
    const from = prev

    const tick = (now: number) => {
      const progress = Math.min((now - start) / ANIMATION_DURATION, 1)
      const current = from + (target - from) * easeOutQuad(progress)
      setDisplay(current)
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        prevRef.current = target
        setDisplay(target)
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    }
  }, [target])

  return (
    <span
      className={cn(
        'tabular-nums',
        counting && 'motion-safe:animate-pulse motion-reduce:animate-none',
        cached && !counting && 'text-muted-foreground',
        className
      )}
      title={cached ? 'Cached from last visit' : undefined}
    >
      {format(display)}
    </span>
  )
}
