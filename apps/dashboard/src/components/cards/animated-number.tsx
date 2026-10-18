import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface AnimatedNumberProps {
  value: string | number
  className?: string
}

function parseNumericValue(value: string | number): {
  num: number
  suffix: string
} {
  if (typeof value === 'number') return { num: Math.round(value), suffix: '' }

  const match = value.match(/^(-?\d*\.?\d+)(.*)$/)
  if (!match) return { num: 0, suffix: String(value) }

  return { num: Math.round(parseFloat(match[1])), suffix: match[2] }
}

function easeOutQuad(t: number): number {
  return t * (2 - t)
}

const ANIMATION_DURATION = 600

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
