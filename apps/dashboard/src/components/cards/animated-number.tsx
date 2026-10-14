import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface AnimatedNumberProps {
  value: string | number
  className?: string
}

/**
 * Extracts numeric value from a string or number
 * Handles formats like "150.5 GiB", "1.2K", etc.
 * Returns the integer portion for animation
 */
function parseNumericValue(value: string | number): {
  num: number
  suffix: string
} {
  if (typeof value === 'number') return { num: Math.round(value), suffix: '' }

  const match = value.match(/^(-?\d*\.?\d+)(.*)$/)
  if (!match) return { num: 0, suffix: String(value) }

  return { num: Math.round(parseFloat(match[1])), suffix: match[2] }
}

/**
 * Ease-out quadratic function for smooth animation
 */
function easeOutQuad(t: number): number {
  return t * (2 - t)
}

/**
 * Duration of animation in milliseconds
 */
const ANIMATION_DURATION = 600

/**
 * AnimatedNumber component that smoothly animates integer number changes
 *
 * Features:
 * - Integer-only counting animation with easing
 * - Preserves suffixes (e.g., "150 GiB" keeps the " GiB")
 * - Uses requestAnimationFrame for smooth 60fps animation
 * - Tracks previous value for seamless transitions
 */
export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  const { num: targetNum, suffix } = parseNumericValue(value)
  const [displayNum, setDisplayNum] = useState(targetNum)
  const prevNumRef = useRef(targetNum)
  const animationRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    const prevNum = prevNumRef.current
    if (prevNum === targetNum) return

    startTimeRef.current = performance.now()
    const startNum = prevNum

    const animate = (currentTime: number) => {
      const startTime = startTimeRef.current!
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1)
      const easedProgress = easeOutQuad(progress)

      const currentNum = Math.round(
        startNum + (targetNum - startNum) * easedProgress
      )
      setDisplayNum(currentNum)

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate)
      } else {
        prevNumRef.current = targetNum
      }
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [targetNum])

  return (
    <span className={cn('tabular-nums', className)}>
      {displayNum.toLocaleString()}
      {suffix}
    </span>
  )
}
